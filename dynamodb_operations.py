import bcrypt
import boto3
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
logger = logging.getLogger(__name__)
logger_auth = logging.getLogger(__name__ + "_auth")

try:
    dynamodb_resource = boto3.resource("dynamodb", region_name=AWS_REGION)
    users_table = dynamodb_resource.Table(USERS_TABLE_NAME)
    todo_list_table = dynamodb_resource.Table(TODO_LIST_TABLE_NAME)
except Exception as e:
    logger.error(f"Failed to initialize DynamoDB resource or table: {e}")
    todo_list_table = None


def hash_password(password: str) -> bytes:
    """Hashes a password using bcrypt."""
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed_password # Store as bytes or base64 encode if needed for JSON

def verify_password(plain_password: str, hashed_password_db: bytes) -> bool:
    """Verifies a plain password against a stored hashed password."""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password_db)

def register_user(username: str, password: str) -> dict:
    """Registers a new user if the username doesn't exist."""
    if not users_table:
        logger_auth.error("Users table not initialized.")
        return {"success": False, "message": "Server error: Users table not initialized."}

    # 1. Check if username already exists
    try:
        response = users_table.get_item(Key={'username': username})
        if 'Item' in response:
            logger_auth.warning(f"Username '{username}' already exists.")
            return {"success": False, "message": "Username already exists."}
    except ClientError as e:
        logger_auth.error(f"Error checking username {username}: {e.response['Error']['Message']}")
        return {"success": False, "message": "Error checking username."}

    # 2. Hash the password
    hashed_pw = hash_password(password)

    # 3. Create a unique UserID (this will be used as PK in your todo-list-data table)
    new_user_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()

    user_data = {
        'username': username,
        'UserID': new_user_id, # This is the ID you'll use for tasks
        'hashed_password': hashed_pw, # Store as Binary (B) in DynamoDB
        'createdAt': timestamp
    }

    # 4. Store the user
    try:
        users_table.put_item(Item=user_data)
        logger_auth.info(f"User '{username}' registered successfully with UserID: {new_user_id}.")
        return {"success": True, "message": "User registered successfully.", "userId": new_user_id, "username": username}
    except ClientError as e:
        logger_auth.error(f"Error registering user {username}: {e.response['Error']['Message']}")
        return {"success": False, "message": "Error registering user."}


def login_user(username: str, password: str) -> dict:
    """Logs in a user if username and password match."""
    if not users_table:
        logger_auth.error("Users table not initialized.")
        return {"success": False, "message": "Server error: Users table not initialized."}

    try:
        response = users_table.get_item(Key={'username': username})
        if 'Item' not in response:
            logger_auth.warning(f"Login attempt for non-existent username: {username}")
            return {"success": False, "message": "Invalid username or password."}

        user_item = response['Item']
        stored_hashed_password = user_item['hashed_password'].value # .value for Binary type from DynamoDB

        if verify_password(password, stored_hashed_password):
            logger_auth.info(f"User '{username}' logged in successfully.")
            # In a real app, you'd generate a session token (e.g., JWT) here.
            # For this mini-project, we'll just return success and user info.
            return {
                "success": True,
                "message": "Login successful.",
                "userId": user_item['UserID'], # Crucial: Send this back to the client
                "username": user_item['username']
            }
        else:
            logger_auth.warning(f"Failed login attempt for username: {username}")
            return {"success": False, "message": "Invalid username or password."}
    except ClientError as e:
        logger_auth.error(f"Error during login for {username}: {e.response['Error']['Message']}")
        return {"success": False, "message": "Error during login."}
    except Exception as e: # Catch other potential errors like 'hashed_password' missing
        logger_auth.error(f"Unexpected error during login for {username}: {str(e)}")
        return {"success": False, "message": "An unexpected error occurred."}


def add_task(
    user_id: str, tab_id: str, task_text: str, task_description: str
) -> Optional[Dict[str, Any]]:
    if not todo_list_table:
        logger.error("DynamoDB table not initialized. Cannot add task.")
        return None

    task_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()

    task_data = {
        "UserID": user_id,
        "SK": f"TASK#{tab_id}#{task_id}",
        "tabId": tab_id,
        "taskId": task_id,
        "text": task_text,
        "description": task_description,
        "completed": False,  # Changed 'status' to 'completed' for consistency
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "entityType": "TASK",  # Good practice for single table design
    }

    try:
        todo_list_table.put_item(Item=task_data)
        logger.info(
            f"Successfully added task {task_id} for user {user_id} in tab {tab_id}"
        )
        return task_data
    except ClientError as e:
        logger.error(
            f"Error adding task for {user_id} in tab {tab_id}: {e.response['Error']['Message']}"
        )
        return None


def get_task(user_id: str, tab_id: str, task_id: str) -> Optional[Dict[str, Any]]:
    """Fetches a single task by its composite key."""
    if not todo_list_table:
        logger.error("DynamoDB table not initialized. Cannot get task.")
        return None
    try:
        response = todo_list_table.get_item(
            Key={"UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}"}
        )
        item = response.get("Item")
        if item:
            logger.info(f"Successfully fetched task {task_id} for user {user_id}")
            return item
        else:
            logger.warning(
                f"Task {task_id} not found for user {user_id} in tab {tab_id}"
            )
            return None
    except ClientError as e:
        logger.error(
            f"Error fetching task {task_id} for user {user_id}: {e.response['Error']['Message']}"
        )
        return None


def get_tasks_for_tab(user_id: str, tab_id: str) -> List[Dict[str, Any]]:
    """Fetches all tasks for a specific tab for a user."""
    if not todo_list_table:
        logger.error("DynamoDB table not initialized. Cannot get tasks for tab.")
        return []
    try:
        response = todo_list_table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("UserID").eq(user_id)
            & boto3.dynamodb.conditions.Key("SK").begins_with(f"TASK#{tab_id}#")
        )
        items = response.get("Items", [])
        logger.info(
            f"Successfully fetched {len(items)} tasks for user {user_id} in tab {tab_id}"
        )
        return items
    except ClientError as e:
        logger.error(
            f"Error fetching tasks for user {user_id} in tab {tab_id}: {e.response['Error']['Message']}"
        )
        return []


def update_task(
    user_id: str,
    tab_id: str,
    task_id: str,
    task_text: Optional[str] = None,
    task_description: Optional[str] = None,
    completed: Optional[bool] = None,
) -> Optional[Dict[str, Any]]:
    """
    Updates specified fields of a task.
    Only provided fields (task_text, task_description, completed) will be updated.
    """
    if not todo_list_table:
        logger.error("DynamoDB table not initialized. Cannot update task.")
        return None

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

    if len(update_expression_parts) == 1:  # Only #updatedAt = :updatedAtVal is present
        logger.warning(
            f"No fields provided to update for task {task_id} beyond timestamp."
        )

    update_expression = ", ".join(update_expression_parts)

    try:
        response = todo_list_table.update_item(
            Key={"UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}"},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values,
            ReturnValues="ALL_NEW",
        )
        logger.info(
            f"Successfully updated task {task_id} for user {user_id} in tab {tab_id}"
        )
        return response.get("Attributes")
    except ClientError as e:
        logger.error(
            f"Error updating task {task_id} for user {user_id}: {e.response['Error']['Message']}"
        )
        return None


def delete_task(user_id: str, tab_id: str, task_id: str) -> bool:
    """Deletes a task. Returns True if successful, False otherwise."""
    if not todo_list_table:
        logger.error("DynamoDB table not initialized. Cannot delete task.")
        return False
    try:
        todo_list_table.delete_item(
            Key={"UserID": user_id, "SK": f"TASK#{tab_id}#{task_id}"}
            # ConditionExpression="attribute_exists(UserID)" # Optional: ensure item exists before delete
        )
        logger.info(
            f"Successfully deleted task {task_id} for user {user_id} in tab {tab_id}"
        )
        return True
    except ClientError as e:
        logger.error(
            f"Error deleting task {task_id} for user {user_id}: {e.response['Error']['Message']}"
        )
        return False


if __name__ == "__main__":
    if not todo_list_table:
        logger.error("Exiting script as DynamoDB table could not be initialized.")
    else:
        TEST_USER = "user_alpha_001"
        TEST_TAB = "daily_work"
        added_task_id = None

        # 1. Add a new task
        logger.info("\n--- ADDING TASK ---")
        new_task_data = add_task(
            user_id=TEST_USER,
            tab_id=TEST_TAB,
            task_text="Prepare meeting agenda",
            task_description="Include points A, B, and C for discussion.",
        )
        if new_task_data:
            added_task_id = new_task_data.get("taskId")
            logger.info(f"Added task: {new_task_data}")

            # 2. Get the added task
            logger.info("\n--- GETTING SINGLE TASK ---")
            fetched_task = get_task(TEST_USER, TEST_TAB, added_task_id)
            if fetched_task:
                logger.info(f"Fetched task: {fetched_task}")

        # 3. Add another task to test fetching multiple
        add_task(
            user_id=TEST_USER,
            tab_id=TEST_TAB,
            task_text="Follow up on client emails",
            task_description="Check responses from Client X and Client Y.",
        )

        # 4. Get all tasks for the tab
        logger.info("\n--- GETTING TASKS FOR TAB ---")
        all_tab_tasks = get_tasks_for_tab(TEST_USER, TEST_TAB)
        logger.info(f"Tasks in tab '{TEST_TAB}':")
        for task in all_tab_tasks:
            logger.info(f"  - {task.get('text')} (Completed: {task.get('completed')})")

        # 5. Update the first task (if it was added)
        if added_task_id:
            logger.info(f"\n--- UPDATING TASK {added_task_id} ---")
            updated_task_data = update_task(
                user_id=TEST_USER,
                tab_id=TEST_TAB,
                task_id=added_task_id,
                task_text="Prepare FINAL meeting agenda",  # Updated text
                completed=True,  # Mark as completed
            )
            if updated_task_data:
                logger.info(f"Updated task data: {updated_task_data}")

            # Verify update by fetching again
            logger.info("\n--- GETTING UPDATED TASK ---")
            fetched_task_after_update = get_task(TEST_USER, TEST_TAB, added_task_id)
            if fetched_task_after_update:
                logger.info(f"Fetched task after update: {fetched_task_after_update}")

        # 6. Delete the first task (if it was added)
        # if added_task_id:
        #     logger.info(f"\n--- DELETING TASK {added_task_id} ---")
        #     delete_success = delete_task(TEST_USER, TEST_TAB, added_task_id)
        #     logger.info(f"Deletion successful for task {added_task_id}: {delete_success}")

        #     # Verify deletion
        #     logger.info("\n--- VERIFYING DELETION ---")
        #     task_after_delete = get_task(TEST_USER, TEST_TAB, added_task_id)
        #     if not task_after_delete:
        #         logger.info(f"Task {added_task_id} successfully deleted and not found.")
        #     else:
        #         logger.error(f"Task {added_task_id} still found after attempting deletion.")

        logger.info("\n--- Example script finished ---")
