import bcrypt
import boto3
from boto3.dynamodb.conditions import Key # Ensure Key is imported for queries
from botocore.exceptions import ClientError

from datetime import datetime
import logging
from typing import Optional, List, Dict, Any
import uuid


USERS_TABLE_NAME = 'taskhive-users'
TODO_LIST_TABLE_NAME = "todo-list-data"
AWS_REGION = "ap-southeast-1"

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__) # General logger for tasks, tabs, prefs
logger_auth = logging.getLogger(__name__ + "_auth") # Specific logger for auth functions

# Initialize DynamoDB resources
try:
    dynamodb_resource = boto3.resource("dynamodb", region_name=AWS_REGION)
    users_table = dynamodb_resource.Table(USERS_TABLE_NAME)
    todo_list_table = dynamodb_resource.Table(TODO_LIST_TABLE_NAME)
    logger.info(f"Successfully initialized DynamoDB tables: {USERS_TABLE_NAME}, {TODO_LIST_TABLE_NAME}")
except Exception as e:
    logger.error(f"Failed to initialize DynamoDB resource or table(s): {e}")
    users_table = None
    todo_list_table = None


# --- AUTHENTICATION FUNCTIONS ---
def hash_password(password: str) -> bytes:
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed_password

def verify_password(plain_password: str, hashed_password_db: bytes) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password_db)

def register_user(username: str, password: str) -> dict:
    if not users_table or not todo_list_table: # Check both tables
        logger_auth.error("One or more DynamoDB tables not initialized during registration.")
        return {"success": False, "message": "Server error: Table initialization."}
    try:
        response = users_table.get_item(Key={'username': username})
        if 'Item' in response:
            logger_auth.warning(f"Username '{username}' already exists.")
            return {"success": False, "message": "Username already exists."}
    except ClientError as e:
        logger_auth.error(f"Error checking username {username}: {e.response['Error']['Message']}")
        return {"success": False, "message": "Error checking username."}

    hashed_pw = hash_password(password)
    new_user_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()
    user_data = {
        'username': username,
        'UserID': new_user_id,
        'hashed_password': hashed_pw, # Boto3 handles Python bytes type correctly for Binary
        'createdAt': timestamp
    }
    try:
        users_table.put_item(Item=user_data)
        # ALSO, create a default PROFILE item for this new user
        profile_data = {
            "UserID": new_user_id,
            "SK": "PROFILE",
            "activeTabId": "main",
            "tabOrder": ["main"], # List of tabIds
            "tabs": [{"tabId": "main", "tabName": "Main"}], # List of tab objects for easy retrieval
            "createdAt": timestamp,
            "updatedAt": timestamp
        }
        todo_list_table.put_item(Item=profile_data)
        logger.info(f"Default PROFILE created for user {new_user_id}")

        logger_auth.info(f"User '{username}' registered successfully with UserID: {new_user_id}.")
        return {"success": True, "message": "User registered successfully.", "userId": new_user_id, "username": username}
    except ClientError as e:
        # Potentially roll back user creation if profile creation fails, or handle differently
        logger_auth.error(f"Error registering user {username} or creating profile: {e.response['Error']['Message']}")
        return {"success": False, "message": "Error registering user."}

def login_user(username: str, password: str) -> dict:
    if not users_table:
        logger_auth.error("Users table not initialized.")
        return {"success": False, "message": "Server error: Users table not initialized."}
    try:
        response = users_table.get_item(Key={'username': username})
        if 'Item' not in response:
            logger_auth.warning(f"Login attempt for non-existent username: {username}")
            return {"success": False, "message": "Invalid username or password."}

        user_item = response['Item']
        logger_auth.info(f"User item retrieved for {username}: {user_item}") # Log the whole item

        if 'hashed_password' not in user_item or not user_item.get('hashed_password'):
            logger_auth.error(f"Missing or empty hashed_password for username: {username}")
            return {"success": False, "message": "Authentication data error."}

        stored_hashed_password_raw = user_item['hashed_password']
        
        # --- ADD DETAILED LOGGING HERE ---
        logger_auth.info(f"Type of stored_hashed_password_raw for {username}: {type(stored_hashed_password_raw)}")
        logger_auth.info(f"Value of stored_hashed_password_raw for {username}: {stored_hashed_password_raw!r}") # !r shows representation

        # Boto3 resource should deserialize Binary (B) to `bytes`.
        # If it's already bytes, this 'if' block is fine.
        # If it's a Boto3 Binary type object (from low-level client), you need .value
        # However, with the Resource API, it should already be Python bytes.
        
        final_hashed_password_bytes = None
        if isinstance(stored_hashed_password_raw, bytes):
            final_hashed_password_bytes = stored_hashed_password_raw
            logger_auth.info(f"hashed_password for {username} is already BYTES.")
        elif hasattr(stored_hashed_password_raw, 'value') and isinstance(stored_hashed_password_raw.value, bytes):
            # This case is for when using the low-level Boto3 client, which returns a Binary object
            # The Resource API (which you are using with Table()) should directly return bytes.
            final_hashed_password_bytes = stored_hashed_password_raw.value
            logger_auth.info(f"hashed_password for {username} was a Binary object, extracted .value as BYTES.")
        else:
             logger_auth.error(f"hashed_password for {username} is NOT in expected bytes format. Actual type: {type(stored_hashed_password_raw)}")
             return {"success": False, "message": "Authentication data format error."}

        if verify_password(password, final_hashed_password_bytes):
            logger_auth.info(f"User '{username}' logged in successfully.")
            return {"success": True, "message": "Login successful.", "userId": user_item['UserID'], "username": user_item['username']}
        else:
            logger_auth.warning(f"Failed login attempt for username: {username}")
            return {"success": False, "message": "Invalid username or password."}
    # ... (rest of your except blocks) ...
    except ClientError as e:
        logger_auth.error(f"ClientError during login for {username}: {e.response['Error']['Message']}")
        return {"success": False, "message": "Error during login (ClientError)."}
    except Exception as e:
        logger_auth.error(f"Unexpected error during login for {username}: {str(e)} - Type: {type(e)}")
        import traceback
        logger_auth.error(traceback.format_exc()) # Log full traceback for unexpected errors
        return {"success": False, "message": "An unexpected error occurred."}

def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Fetches the user's PROFILE item from todo_list_table."""
    if not todo_list_table:
        logger.error("Todo list table (for profile) not initialized.")
        return None
    try:
        response = todo_list_table.get_item(Key={'UserID': user_id, 'SK': 'PROFILE'})
        return response.get('Item')
    except ClientError as e:
        logger.error(f"Error fetching profile for user {user_id}: {e.response['Error']['Message']}")
        return None

def get_user_tabs(user_id: str) -> List[Dict[str, str]]:
    """ Fetches tabs for a user from their PROFILE item. """
    if not todo_list_table:
        logger.error("Todo list table not initialized. Cannot get tabs.")
        return [{"tabId": "main", "tabName": "Main"}]

    profile = get_user_profile(user_id)
    if profile and 'tabs' in profile and isinstance(profile['tabs'], list):
        # Ensure 'main' tab is correctly represented if it exists in the list
        tabs_list = profile['tabs']
        if not any(t.get('tabId') == 'main' for t in tabs_list):
            tabs_list.insert(0, {"tabId": "main", "tabName": "Main"})
        # Ensure correct order based on tabOrder if available
        if 'tabOrder' in profile and isinstance(profile['tabOrder'], list):
            ordered_tabs = []
            tab_map = {t['tabId']: t for t in tabs_list}
            for tab_id_in_order in profile['tabOrder']:
                if tab_id_in_order in tab_map:
                    ordered_tabs.append(tab_map[tab_id_in_order])
                    del tab_map[tab_id_in_order] # Remove from map to avoid duplicates
            ordered_tabs.extend(tab_map.values()) # Add any remaining tabs not in order
            tabs_list = ordered_tabs

        logger.info(f"Fetched {len(tabs_list)} tabs for user {user_id} from profile.")
        return tabs_list
    else:
        logger.warning(f"No 'tabs' array in profile for user {user_id} or profile missing. Returning default.")
        # Create a default profile if it's missing entirely (should have been created on register)
        if not profile:
            timestamp = datetime.now().isoformat()
            default_profile_data = {
                "UserID": user_id, "SK": "PROFILE", "activeTabId": "main",
                "tabOrder": ["main"], "tabs": [{"tabId": "main", "tabName": "Main"}],
                "createdAt": timestamp, "updatedAt": timestamp
            }
            try:
                todo_list_table.put_item(Item=default_profile_data)
                logger.info(f"Created missing default PROFILE for user {user_id} during get_user_tabs.")
                return default_profile_data["tabs"]
            except ClientError as e_profile:
                logger.error(f"Failed to create missing default PROFILE for user {user_id}: {e_profile.response['Error']['Message']}")
        return [{"tabId": "main", "tabName": "Main"}]


def add_user_tab(user_id: str, tab_name: str) -> Optional[Dict[str, Any]]: # Changed return type hint
    if not todo_list_table:
        logger.error("Todo list table not initialized. Cannot add tab.")
        return None # Or an error dictionary

    sanitized_tab_id = tab_name.strip().replace(" ", "-").lower()
    if not sanitized_tab_id:
        logger.error("Tab name results in empty ID.")
        return {"success": False, "message": "Tab name is invalid."} # Return error dict

    timestamp = datetime.now().isoformat()
    new_tab_object = {"tabId": sanitized_tab_id, "tabName": tab_name.strip()}

    try:
        # Atomically add to the 'tabs' list and 'tabOrder' list in the PROFILE item.
        response = todo_list_table.update_item(
            Key={'UserID': user_id, 'SK': 'PROFILE'},
            UpdateExpression="SET #tabs_attr = list_append(if_not_exists(#tabs_attr, :empty_list), :new_tab_val_list), "
                             "#tabOrder_attr = list_append(if_not_exists(#tabOrder_attr, :empty_list_order), :new_tab_id_list), "
                             "#updatedAt = :ts",
            ExpressionAttributeNames={
                '#tabs_attr': 'tabs', # Use different placeholder if 'tabs' is a reserved word (it's not)
                '#tabOrder_attr': 'tabOrder',
                '#updatedAt': 'updatedAt'
            },
            ConditionExpression="attribute_exists(SK) AND SK = :profile_sk_val AND NOT contains(#tabOrder_attr, :check_tab_id_val)",
            ExpressionAttributeValues={ # Need to redefine EAV for ConditionExpression if placeholders are shared
                ':new_tab_val_list': [new_tab_object],
                ':new_tab_id_list': [sanitized_tab_id],
                ':empty_list': [],
                ':empty_list_order': [],
                ':ts': timestamp,
                ':check_tab_id_val': sanitized_tab_id,
                ':profile_sk_val': "PROFILE" # Value for SK check in condition
            },
            ReturnValues="UPDATED_NEW"
        )
        logger.info(f"Tab '{tab_name}' (id: {sanitized_tab_id}) added to profile for user {user_id}.")
        # Return the object that was added to the list, which is new_tab_object
        return new_tab_object
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            logger.warning(f"Conditional check failed for add_user_tab. Tab '{tab_name}' (id: {sanitized_tab_id}) might already exist or PROFILE missing for user {user_id}.")
            # Attempt to fetch the profile to see if the tab is indeed there
            profile = get_user_profile(user_id)
            if profile and 'tabs' in profile: # Check if profile and 'tabs' attribute exist
                existing_tab = next((t for t in profile.get('tabs', []) if t.get('tabId') == sanitized_tab_id), None)
                if existing_tab:
                    logger.info(f"Tab '{sanitized_tab_id}' confirmed to exist for user {user_id}. Returning existing tab.")
                    return existing_tab # Return the existing tab object
                else:
                    logger.error(f"Tab '{sanitized_tab_id}' not found in profile despite conditional check fail for user {user_id}. This is unexpected.")
                    return {"success": False, "message": "Tab creation conflict, but tab not found."}
            else:
                logger.error(f"PROFILE item missing or malformed for user {user_id} after conditional check fail for add_user_tab.")
                # This case indicates the PROFILE item itself might be missing,
                # which should have been caught by "attribute_exists(SK) AND SK = :profile_sk_val"
                # So, more likely the "NOT contains" part failed, meaning tabId IS in tabOrder.
                # But if profile is still None here, it's an issue.
                return {"success": False, "message": "Profile error while handling existing tab."}
        
        logger.error(f"Error adding tab '{tab_name}' for user {user_id}: {e.response['Error']['Message']}")
        return {"success": False, "message": f"Server error adding tab: {e.response['Error']['Message']}"} # Return error dict
    except Exception as ex: # Catch any other unexpected errors
        logger.error(f"Unexpected error in add_user_tab for {user_id}, tab {tab_name}: {str(ex)}")
        import traceback
        logger.error(traceback.format_exc())
        return {"success": False, "message": "Unexpected server error adding tab."}

def delete_user_tab_and_tasks(user_id: str, tab_id_to_delete: str) -> bool:
    if not todo_list_table:
        logger.error("Todo list table not initialized.")
        return False
    if tab_id_to_delete == "main":
        logger.warning(f"Attempt to delete 'main' tab by user {user_id} denied.")
        return False

    try:
        # 1. Delete all tasks associated with this tab for the user
        tasks_to_delete_response = todo_list_table.query(
            KeyConditionExpression=Key("UserID").eq(user_id) & Key("SK").begins_with(f"TASK#{tab_id_to_delete}#")
        )
        tasks_to_delete = tasks_to_delete_response.get("Items", [])
        if tasks_to_delete:
            with todo_list_table.batch_writer() as batch:
                for task in tasks_to_delete:
                    batch.delete_item(Key={"UserID": user_id, "SK": task["SK"]})
            logger.info(f"Deleted {len(tasks_to_delete)} tasks for tab '{tab_id_to_delete}' for user {user_id}.")

        # 2. Update the PROFILE item: remove from 'tabs' list and 'tabOrder' list
        profile = get_user_profile(user_id)
        if not profile:
            logger.warning(f"No profile found for user {user_id} during tab deletion. Tasks may have been deleted if any.")
            return True # Tasks are deleted, but profile couldn't be updated

        updated_tabs_list = [t for t in profile.get('tabs', []) if t.get('tabId') != tab_id_to_delete]
        updated_tab_order = [tid for tid in profile.get('tabOrder', []) if tid != tab_id_to_delete]
        
        # If active tab was the one deleted, reset to 'main'
        new_active_tab_id = profile.get('activeTabId', 'main')
        if new_active_tab_id == tab_id_to_delete:
            new_active_tab_id = 'main'

        timestamp = datetime.now().isoformat()
        todo_list_table.update_item(
            Key={'UserID': user_id, 'SK': 'PROFILE'},
            UpdateExpression="SET #tabs = :tabs_val, #tabOrder = :order_val, #activeTab = :active_val, #updatedAt = :ts",
            ExpressionAttributeNames={
                '#tabs': 'tabs',
                '#tabOrder': 'tabOrder',
                '#activeTab': 'activeTabId',
                '#updatedAt': 'updatedAt'
            },
            ExpressionAttributeValues={
                ':tabs_val': updated_tabs_list,
                ':order_val': updated_tab_order,
                ':active_val': new_active_tab_id,
                ':ts': timestamp
            }
        )
        logger.info(f"Tab '{tab_id_to_delete}' removed from profile for user {user_id}.")
        return True
    except ClientError as e:
        logger.error(f"Error deleting tab '{tab_id_to_delete}' for user {user_id}: {e.response['Error']['Message']}")
        return False

def get_user_active_tab_preference(user_id: str) -> str:
    """Fetches the user's active tab preference from their PROFILE item."""
    profile = get_user_profile(user_id)
    if profile and 'activeTabId' in profile:
        logger.info(f"Retrieved activeTabId '{profile['activeTabId']}' for user {user_id}")
        return profile['activeTabId']
    logger.info(f"No activeTabId preference found for user {user_id}, defaulting to 'main'.")
    return "main" # Default

def set_user_active_tab_preference(user_id: str, active_tab_id: str) -> bool:
    """Sets the user's active tab preference in their PROFILE item."""
    if not todo_list_table:
        logger.error("Todo list table not initialized. Cannot set active tab preference.")
        return False
    try:
        timestamp = datetime.now().isoformat()
        todo_list_table.update_item(
            Key={'UserID': user_id, 'SK': 'PROFILE'},
            UpdateExpression="SET #activeTab = :val, #updatedAt = :ts",
            ExpressionAttributeNames={
                '#activeTab': 'activeTabId',
                '#updatedAt': 'updatedAt'
            },
            ExpressionAttributeValues={
                ':val': active_tab_id,
                ':ts': timestamp
            }
            # This will create/update the PROFILE item implicitly if UserID is PK and SK='PROFILE'
        )
        logger.info(f"Set activeTabId to '{active_tab_id}' for user {user_id}")
        return True
    except ClientError as e:
        logger.error(f"Error setting active tab preference for user {user_id}: {e.response['Error']['Message']}")
        return False


# --- TASK CRUD OPERATIONS (using todo_list_table) ---
def add_task(user_id: str, tab_id: str, task_text: str, task_description: str) -> Optional[Dict[str, Any]]:
    if not todo_list_table:
        logger.error("Todo list table not initialized. Cannot add task.")
        return None
    task_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()
    task_data = {
        "UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}", "tabId": tab_id, "taskId": task_id,
        "text": task_text, "description": task_description, "completed": False,
        "createdAt": timestamp, "updatedAt": timestamp, "entityType": "TASK",
    }
    try:
        todo_list_table.put_item(Item=task_data)
        logger.info(f"Successfully added task {task_id} for user {user_id} in tab {tab_id}")
        return task_data
    except ClientError as e:
        logger.error(f"Error adding task for {user_id} in tab {tab_id}: {e.response['Error']['Message']}")
        return None

def get_task(user_id: str, tab_id: str, task_id: str) -> Optional[Dict[str, Any]]:
    if not todo_list_table: return None
    try:
        response = todo_list_table.get_item(Key={"UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}"})
        item = response.get("Item")
        if item: logger.info(f"Fetched task {task_id} for user {user_id}")
        else: logger.warning(f"Task {task_id} not found for user {user_id} in tab {tab_id}")
        return item
    except ClientError as e:
        logger.error(f"Error fetching task {task_id} for user {user_id}: {e.response['Error']['Message']}")
        return None

def get_tasks_for_tab(user_id: str, tab_id: str) -> List[Dict[str, Any]]:
    if not todo_list_table: return []
    try:
        # Ensure you use boto3.dynamodb.conditions.Key for queries
        response = todo_list_table.query(
            KeyConditionExpression=Key("UserID").eq(user_id) & Key("SK").begins_with(f"TASK#{tab_id}#")
        )
        items = response.get("Items", [])
        logger.info(f"Fetched {len(items)} tasks for user {user_id} in tab {tab_id}")
        return items
    except ClientError as e:
        logger.error(f"Error fetching tasks for user {user_id} in tab {tab_id}: {e.response['Error']['Message']}")
        return []

def update_task(user_id: str, tab_id: str, task_id: str, task_text: Optional[str] = None, task_description: Optional[str] = None, completed: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    if not todo_list_table: return None
    timestamp = datetime.now().isoformat()
    update_expression_parts = ["SET #updatedAt = :updatedAtVal"]
    expression_attribute_names = {"#updatedAt": "updatedAt"}
    expression_attribute_values = {":updatedAtVal": timestamp}
    if task_text is not None:
        update_expression_parts.append("#text = :textVal")
        expression_attribute_names["#text"] = "text"
        expression_attribute_values[":textVal"] = task_text
    if task_description is not None:
        update_expression_parts.append("#description = :descriptionVal")
        expression_attribute_names["#description"] = "description"
        expression_attribute_values[":descriptionVal"] = task_description
    if completed is not None:
        update_expression_parts.append("#completed = :completedVal")
        expression_attribute_names["#completed"] = "completed"
        expression_attribute_values[":completedVal"] = completed
    if len(update_expression_parts) == 1:
        logger.warning(f"No fields to update for task {task_id} beyond timestamp.")
    update_expression = ", ".join(update_expression_parts)
    try:
        response = todo_list_table.update_item(
            Key={"UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}"},
            UpdateExpression=update_expression, ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values, ReturnValues="ALL_NEW",
        )
        logger.info(f"Updated task {task_id} for user {user_id} in tab {tab_id}")
        return response.get("Attributes")
    except ClientError as e:
        logger.error(f"Error updating task {task_id} for user {user_id}: {e.response['Error']['Message']}")
        return None

def delete_task(user_id: str, tab_id: str, task_id: str) -> bool:
    if not todo_list_table: return False
    try:
        todo_list_table.delete_item(Key={"UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}"})
        logger.info(f"Deleted task {task_id} for user {user_id} in tab {tab_id}")
        return True
    except ClientError as e:
        logger.error(f"Error deleting task {task_id} for user {user_id}: {e.response['Error']['Message']}")
        return False

# --- MAIN FOR TESTING (Ensure tables are initialized before calling) ---
if __name__ == "__main__":
    # Basic logging for script execution
    logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    logger.info("--- RUNNING dynamodb_operations.py DIRECTLY FOR TESTING ---")

    if not users_table or not todo_list_table:
        logger.error("One or both DynamoDB tables could not be initialized. Exiting tests.")
    else:
        # Test User Registration
        logger.info("\n--- TESTING USER REGISTRATION ---")
        test_username = f"testuser_{str(uuid.uuid4())[:6]}"
        test_password = "Password123!"
        reg_result = register_user(test_username, test_password)
        logger.info(f"Registration for {test_username}: {reg_result}")
        assert reg_result.get("success"), "Registration failed"
        test_user_id = reg_result.get("userId")

        # Test User Login
        logger.info("\n--- TESTING USER LOGIN ---")
        login_result = login_user(test_username, test_password)
        logger.info(f"Login for {test_username}: {login_result}")
        assert login_result.get("success"), "Login failed"
        assert login_result.get("userId") == test_user_id

        # Test Get User Tabs (should have 'main' by default from PROFILE)
        logger.info(f"\n--- TESTING GET USER TABS for {test_user_id} ---")
        tabs = get_user_tabs(test_user_id)
        logger.info(f"Initial tabs: {tabs}")
        assert any(t['tabId'] == 'main' for t in tabs), "Main tab missing initially"

        # Test Set Active Tab Preference
        logger.info("\n--- TESTING SET ACTIVE TAB PREFERENCE ---")
        set_pref_success = set_user_active_tab_preference(test_user_id, "work")
        assert set_pref_success, "Setting active tab preference failed"
        active_pref = get_user_active_tab_preference(test_user_id)
        logger.info(f"Active tab preference after set: {active_pref}")
        assert active_pref == "work", "Active tab preference not set correctly"
        set_user_active_tab_preference(test_user_id, "main") # Reset

        # Test Add User Tab
        logger.info("\n--- TESTING ADD USER TAB ---")
        new_tab = add_user_tab(test_user_id, "Projects New")
        logger.info(f"Add tab result: {new_tab}")
        assert new_tab and new_tab.get("tabId") == "projects-new", "Adding new tab failed"
        tabs_after_add = get_user_tabs(test_user_id)
        logger.info(f"Tabs after add: {tabs_after_add}")
        assert any(t['tabId'] == 'projects-new' for t in tabs_after_add), "New tab 'projects-new' not found after add"

        # Test adding existing tab ID (should not duplicate in tabOrder based on ConditionExpression)
        logger.info("\n--- TESTING ADD EXISTING TAB ID ---")
        existing_tab_add_result = add_user_tab(test_user_id, "Projects New") # Try adding same name
        logger.info(f"Add existing tab result: {existing_tab_add_result}") # Should ideally show it exists
        assert existing_tab_add_result and existing_tab_add_result.get("tabId") == "projects-new", "Adding existing tab should return tab info"
        tabs_after_duplicate_add = get_user_tabs(test_user_id)
        count_projects_new = sum(1 for t in tabs_after_duplicate_add if t['tabId'] == 'projects-new')
        assert count_projects_new == 1, "Tab 'projects-new' should only appear once in the list"


        # Test Task Operations
        TEST_TAB_ID = "projects-new"
        logger.info(f"\n--- TESTING TASK OPERATIONS for tab '{TEST_TAB_ID}' ---")
        task1_data = add_task(test_user_id, TEST_TAB_ID, "Design phase", "Finalize mockups")
        assert task1_data and task1_data.get("taskId"), "Adding task1 failed"
        task1_id = task1_data["taskId"]
        logger.info(f"Added task1: {task1_id}")

        task2_data = add_task(test_user_id, TEST_TAB_ID, "Development", "Setup project structure")
        assert task2_data and task2_data.get("taskId"), "Adding task2 failed"
        task2_id = task2_data["taskId"]
        logger.info(f"Added task2: {task2_id}")

        tasks_in_project_tab = get_tasks_for_tab(test_user_id, TEST_TAB_ID)
        logger.info(f"Tasks in '{TEST_TAB_ID}': {len(tasks_in_project_tab)}")
        assert len(tasks_in_project_tab) == 2, "Incorrect number of tasks in project tab"

        # Test Update Task
        update_success = update_task(test_user_id, TEST_TAB_ID, task1_id, completed=True, task_text="Design phase COMPLETE")
        assert update_success and update_success.get("completed") == True, "Updating task1 failed"
        logger.info(f"Updated task1: {update_success}")

        # Test Delete Task
        delete_task_success = delete_task(test_user_id, TEST_TAB_ID, task2_id)
        assert delete_task_success, "Deleting task2 failed"
        logger.info(f"Task {task2_id} deletion status: {delete_task_success}")
        tasks_after_delete = get_tasks_for_tab(test_user_id, TEST_TAB_ID)
        assert len(tasks_after_delete) == 1, "Task count incorrect after delete"
        assert not any(t['taskId'] == task2_id for t in tasks_after_delete), "Task2 not actually deleted"

        # Test Delete User Tab (and its tasks)
        logger.info(f"\n--- TESTING DELETE USER TAB '{TEST_TAB_ID}' ---")
        delete_tab_success = delete_user_tab_and_tasks(test_user_id, TEST_TAB_ID)
        assert delete_tab_success, f"Deleting tab '{TEST_TAB_ID}' failed"
        logger.info(f"Tab '{TEST_TAB_ID}' deletion status: {delete_tab_success}")
        tabs_after_delete = get_user_tabs(test_user_id)
        logger.info(f"Tabs after delete: {tabs_after_delete}")
        assert not any(t['tabId'] == TEST_TAB_ID for t in tabs_after_delete), f"Tab '{TEST_TAB_ID}' not actually deleted from profile"
        tasks_for_deleted_tab = get_tasks_for_tab(test_user_id, TEST_TAB_ID)
        assert len(tasks_for_deleted_tab) == 0, "Tasks for deleted tab were not all deleted"

        logger.info("\n--- All tests in dynamodb_operations.py finished ---")
