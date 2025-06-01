from flask import Flask, request, jsonify, session, send_from_directory, redirect, url_for
from flask_cors import CORS
import logging
import os

# Assuming dynamodb_operations.py is in the same directory and has all the functions
import dynamodb_operations as ddb

app = Flask(__name__)

# --- Secret Key for Session Management ---
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'your-super-secret-and-random-dev-key-123!') # CHANGE THIS!

# --- CORS Configuration ---
CORS(
    app,
    supports_credentials=True # Important for session cookies if frontend/backend are different origins
)

# --- Logging Configuration ---
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
# Use app.logger for Flask-specific logging
app.logger.setLevel(logging.INFO)


# --- Static File Serving & Basic Page Routes ---
@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory(os.path.join(app.root_path, 'static'), filename)

@app.route('/login')
def login_page():
    return send_from_directory(app.root_path, 'login.html')

@app.route('/')
def index_page():
    if 'user_id' not in session:
        app.logger.info("User not in session, redirecting to login.")
        return redirect(url_for('login_page'))
    app.logger.info(f"User {session.get('username')} in session, serving index.html.")
    return send_from_directory(app.root_path, 'index.html')


# --- Authentication Endpoints ---
@app.route("/api/auth/register", methods=["POST"])
def api_register_user():
    data = request.get_json()
    if not data: return jsonify({"error": "Request body must be JSON"}), 400
    username = data.get("username")
    password = data.get("password")
    if not all([username, password]): return jsonify({"error": "Username and password are required"}), 400
    
    app.logger.info(f"Registration attempt for username: {username}")
    result = ddb.register_user(username, password)
    if result.get("success"):
        return jsonify(result), 201
    else:
        status_code = 409 if result.get("message") == "Username already exists." else 400
        return jsonify(result), status_code

@app.route("/api/auth/login", methods=["POST"])
def api_login_user():
    data = request.get_json()
    if not data: return jsonify({"error": "Request body must be JSON"}), 400
    username = data.get("username")
    password = data.get("password")
    if not all([username, password]): return jsonify({"error": "Username and password are required"}), 400

    app.logger.info(f"Login attempt for username: {username}")
    result = ddb.login_user(username, password)
    if result.get("success"):
        session["user_id"] = result.get("userId")
        session["username"] = result.get("username")
        app.logger.info(f"User {session['username']} (ID: {session['user_id']}) logged in, session set.")
        return jsonify(result), 200
    else:
        return jsonify(result), 401

@app.route("/api/auth/logout", methods=["POST"])
def api_logout_user():
    user_id = session.pop("user_id", None)
    username = session.pop("username", None) # Also pop username
    if user_id:
        app.logger.info(f"User {username} (ID: {user_id}) logged out.")
        return jsonify({"message": "Logged out successfully"}), 200
    else:
        app.logger.info("Logout attempt with no active session.")
        return jsonify({"message": "No active session to log out"}), 200

@app.route("/api/auth/status", methods=["GET"])
def api_auth_status():
    if "user_id" in session and "username" in session:
        app.logger.debug(f"Auth status: Logged in as {session['username']} (ID: {session['user_id']})")
        return jsonify({
            "isLoggedIn": True, "userId": session["user_id"], "username": session["username"]
        }), 200
    else:
        app.logger.debug("Auth status: Not logged in.")
        return jsonify({"isLoggedIn": False}), 200

# --- Helper for Authenticated Routes ---
def get_authenticated_user_id():
    user_id = session.get("user_id")
    if not user_id:
        app.logger.warning("Attempt to access protected route without authentication.")
    return user_id

# --- TAB MANAGEMENT ENDPOINTS ---
@app.route('/api/tabs', methods=['GET'])
def api_get_tabs():
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    
    app.logger.info(f"Fetching tabs for user_id: {user_id}")
    tabs = ddb.get_user_tabs(user_id) # This function needs to be in ddb
    return jsonify(tabs), 200

@app.route('/api/tabs', methods=['POST'])
def api_add_tab():
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    
    data = request.get_json()
    if not data or 'tabName' not in data or not data['tabName'].strip():
        return jsonify({"error": "Missing or empty tabName"}), 400
    
    tab_name = data['tabName'].strip()
    app.logger.info(f"Adding tab '{tab_name}' for user_id: {user_id}")
    new_tab = ddb.add_user_tab(user_id, tab_name) # This function needs to be in ddb
    
    if new_tab and new_tab.get("tabId"): # Check if tabId was successfully generated/returned
        return jsonify(new_tab), 201
    elif new_tab and new_tab.get("message") == "Tab already exists but could not retrieve.": # Handle specific case
         return jsonify(new_tab), 409 # Conflict, or return the existing tab info if you prefer
    elif new_tab and "success" in new_tab and not new_tab["success"]: # General failure from ddb function
        return jsonify(new_tab), 400
    elif not new_tab: # Other unexpected failure
        return jsonify({"error": "Failed to add tab"}), 500
    else: # Should have tabId if successful
        return jsonify(new_tab), 201


@app.route('/api/tabs/<string:tab_id_to_delete>', methods=['DELETE'])
def api_delete_tab(tab_id_to_delete):
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401

    if tab_id_to_delete == "main":
        return jsonify({"error": "Cannot delete the main tab"}), 400
        
    app.logger.info(f"Deleting tab '{tab_id_to_delete}' for user_id: {user_id}")
    success = ddb.delete_user_tab_and_tasks(user_id, tab_id_to_delete) # This function needs to be in ddb
    
    if success:
        return jsonify({"message": "Tab deleted successfully"}), 200 # Or 204 No Content
    else:
        return jsonify({"error": "Failed to delete tab or tab not found"}), 404 # or 500

# --- USER PREFERENCES ENDPOINTS ---
@app.route('/api/user/preferences/active-tab', methods=['GET'])
def api_get_active_tab():
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    
    app.logger.info(f"Getting active tab preference for user_id: {user_id}")
    active_tab_id = ddb.get_user_active_tab_preference(user_id) # This function needs to be in ddb
    return jsonify({"activeTabId": active_tab_id}), 200

@app.route('/api/user/preferences/active-tab', methods=['PUT'])
def api_set_active_tab():
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    
    data = request.get_json()
    if not data or 'activeTabId' not in data:
        return jsonify({"error": "Missing activeTabId"}), 400
        
    active_tab_id = data['activeTabId']
    app.logger.info(f"Setting active tab to '{active_tab_id}' for user_id: {user_id}")
    success = ddb.set_user_active_tab_preference(user_id, active_tab_id) # This function needs to be in ddb
    
    if success:
        return jsonify({"message": "Active tab preference updated"}), 200
    else:
        return jsonify({"error": "Failed to update active tab preference"}), 500

# --- TASK ENDPOINTS (These should already be in your api_app.py) ---
@app.route("/api/tasks", methods=["POST"])
def api_add_task():
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json()
    if not data: return jsonify({"error": "Request body must be JSON"}), 400
    tab_id = data.get("tabId")
    task_text = data.get("text")
    task_description = data.get("description")
    if not all([tab_id, task_text]): return jsonify({"error": "Missing tabId or text"}), 400
    app.logger.info(f"Add task for user {user_id}, tab {tab_id}: '{task_text}'")
    new_task = ddb.add_task(user_id, tab_id, task_text, task_description or "")
    if new_task:
        return jsonify(new_task), 201
    else:
        return jsonify({"error": "Failed to add task"}), 500

@app.route("/api/tasks/<string:tab_id>", methods=["GET"])
def api_get_tasks_for_tab(tab_id):
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    app.logger.info(f"Get tasks for user {user_id}, tab {tab_id}")
    tasks = ddb.get_tasks_for_tab(user_id, tab_id)
    return jsonify(tasks), 200

@app.route("/api/tasks/<string:tab_id>/<string:task_id>", methods=["GET"])
def api_get_single_task(tab_id, task_id):
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    app.logger.info(f"Get single task for user {user_id}, tab {tab_id}, task {task_id}")
    task = ddb.get_task(user_id, tab_id, task_id)
    if task:
        return jsonify(task), 200
    else:
        return jsonify({"error": "Task not found"}), 404

@app.route("/api/tasks/<string:tab_id>/<string:task_id>", methods=["PUT"])
def api_update_task(tab_id, task_id):
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json()
    if not data: return jsonify({"error": "Request body must be JSON"}), 400
    updates = {
        "task_text": data.get("text"),
        "task_description": data.get("description"),
        "completed": data.get("completed")
    }
    # Filter out None values so ddb.update_task only gets fields to actually update
    updates_to_send = {k: v for k, v in updates.items() if v is not None}

    if not updates_to_send: return jsonify({"error": "No update fields provided"}), 400
    app.logger.info(f"Update task for user {user_id}, task {task_id} with: {updates_to_send}")
    updated_task = ddb.update_task(user_id=user_id, tab_id=tab_id, task_id=task_id, **updates_to_send)
    if updated_task:
        return jsonify(updated_task), 200
    else:
        return jsonify({"error": "Failed to update task or task not found"}), 404 # or 500

@app.route("/api/tasks/<string:tab_id>/<string:task_id>", methods=["DELETE"])
def api_delete_task(tab_id, task_id):
    user_id = get_authenticated_user_id()
    if not user_id: return jsonify({"error": "Unauthorized"}), 401
    app.logger.info(f"Delete task for user {user_id}, task {task_id}")
    success = ddb.delete_task(user_id, tab_id, task_id)
    if success:
        return jsonify({"message": "Task deleted successfully"}), 200 # Or 204 No Content
    else:
        return jsonify({"error": "Failed to delete task or task not found"}), 404 # or 500


if __name__ == "__main__":
    app.logger.info("Starting TaskHive Flask development server...")
    app.run(host="0.0.0.0", port=5000, debug=True) # debug=True is fine for EC2 dev
