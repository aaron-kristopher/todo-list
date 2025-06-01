from flask import Flask, request, jsonify, session, send_from_directory, redirect, url_for
from flask_cors import CORS
import logging

import dynamodb_operations as ddb

app = Flask(__name__)
app.secret_key="I_AM_TOO_LAZY_TO_GENERATE_RANDOM_KEY_420_69"
CORS(
    app
)  # This allows all origins by default. For production, configure it more strictly.

# Configure basic logging for Flask app
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
app.logger.setLevel(logging.INFO)  # Ensure Flask's logger also picks up INFO level

@app.route("/")
def index_page():
    if "user_id" not in session:
        return redirect(url_for("login_page"))
    return send_from_directory(app.root_path, "index.html")

@app.route("/login")
def login_page():
    return send_from_directory(app.root_path, "login.html")

@app.route("/api/auth/register", methods=["POST"])
def api_register_user():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    username = data.get("username")
    password = data.get("password")

    if not all([username, password]):
        return jsonify({"error": "Username and password are required"}), 400

    result = ddb.register_user(username, password)
    if result.get("success"):
        return jsonify(result), 201
    else:
        return jsonify(result), 400  # Or 409 for "already exists"


@app.route("/api/auth/login", methods=["POST"])
def api_login_user():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    username = data.get("username")
    password = data.get("password")

    if not all([username, password]):
        return jsonify({"error": "Username and password are required"}), 400

    result = ddb.login_user(username, password)
    if result.get("success"):
        # Basic session management: Store UserID in session
        # This is a simple approach. JWT is more common for stateless APIs.
        session["user_id"] = result.get("userId")
        session["username"] = result.get("username")
        app.logger.info(
            f"User {session['username']} (ID: {session['user_id']}) logged in, session set."
        )
        return jsonify(result), 200
    else:
        return jsonify(result), 401  # Unauthorized


@app.route("/api/auth/logout", methods=["POST"])
def api_logout_user():
    user_id = session.pop("user_id", None)  # Remove user_id from session
    session.pop("username", None)
    if user_id:
        app.logger.info(f"User ID {user_id} logged out.")
        return jsonify({"message": "Logged out successfully"}), 200
    else:
        return jsonify({"message": "No active session to log out"}), 200


@app.route("/api/auth/status", methods=["GET"])
def api_auth_status():
    if "user_id" in session and "username" in session:
        app.logger.info(
            f"Auth status check: User {session['username']} (ID: {session['user_id']}) is logged in."
        )
        return (
            jsonify(
                {
                    "isLoggedIn": True,
                    "userId": session["user_id"],
                    "username": session["username"],
                }
            ),
            200,
        )
    else:
        app.logger.info("Auth status check: No user logged in.")
        return jsonify({"isLoggedIn": False}), 200


def get_authenticated_user_id():
    return session.get("user_id")


# --- Task Endpoints ---
@app.route("/api/tasks", methods=["POST"])
def api_add_task():
    user_id = get_authenticated_user_id()  # Get user ID
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    tab_id = data.get("tabId")
    task_text = data.get("text")
    task_description = data.get("description")

    if not all([tab_id, task_text]):  # task_description can be optional
        return jsonify({"error": "Missing tabId or text"}), 400

    app.logger.info(f"Received add task request for user {user_id}, tab {tab_id}")
    new_task = ddb.add_task(
        user_id, tab_id, task_text, task_description or ""
    )  # Pass empty string if no description
    if new_task:
        return jsonify(new_task), 201
    else:
        return jsonify({"error": "Failed to add task"}), 500


@app.route("/api/tasks/<string:tab_id>", methods=["GET"])
def api_get_tasks_for_tab(tab_id):
    user_id = get_authenticated_user_id()  # Get user ID
    app.logger.info(f"Received get tasks request for user {user_id}, tab {tab_id}")
    tasks = ddb.get_tasks_for_tab(user_id, tab_id)
    return jsonify(tasks), 200


@app.route("/api/tasks/<string:tab_id>/<string:task_id>", methods=["GET"])
def api_get_single_task(tab_id, task_id):
    user_id = get_authenticated_user_id()  # Get user ID
    app.logger.info(
        f"Received get single task request for user {user_id}, tab {tab_id}, task {task_id}"
    )
    task = ddb.get_task(user_id, tab_id, task_id)
    if task:
        return jsonify(task), 200
    else:
        return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<string:tab_id>/<string:task_id>", methods=["PUT"])
def api_update_task(tab_id, task_id):
    user_id = get_authenticated_user_id()  # Get user ID
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    task_text = data.get("text")
    task_description = data.get("description")
    completed = data.get("completed")  # Boolean

    # Construct update dictionary carefully, only including fields that are present
    updates = {}
    if task_text is not None:
        updates["task_text"] = task_text
    if task_description is not None:
        updates["task_description"] = task_description
    if completed is not None:
        updates["completed"] = completed

    if not updates:
        return jsonify({"error": "No update fields provided"}), 400

    app.logger.info(
        f"Received update task request for user {user_id}, task {task_id}, updates: {updates}"
    )
    # Your ddb.update_task needs to be adjusted to accept a dictionary of updates
    # Or, you call it like:
    updated_task = ddb.update_task(
        user_id=user_id,
        tab_id=tab_id,
        task_id=task_id,
        task_text=updates.get("task_text"),
        task_description=updates.get("task_description"),
        completed=updates.get("completed"),
    )

    if updated_task:
        return jsonify(updated_task), 200
    else:
        # Check if the task didn't exist in the first place vs. an update error
        # For simplicity now, just return a generic error
        return (
            jsonify({"error": "Failed to update task or task not found"}),
            404,
        )  # or 500


@app.route("/api/tasks/<string:tab_id>/<string:task_id>", methods=["DELETE"])
def api_delete_task(tab_id, task_id):
    user_id = get_authenticated_user_id()  # Get user ID
    app.logger.info(f"Received delete task request for user {user_id}, task {task_id}")
    success = ddb.delete_task(user_id, tab_id, task_id)
    if success:
        return (
            jsonify({"message": "Task deleted successfully"}),
            200,
        )  # Or 204 No Content
    else:
        return (
            jsonify({"error": "Failed to delete task or task not found"}),
            404,
        )  # or 500


if __name__ == "__main__":
    app.logger.info("Starting Flask development server...")
    # Makes the server accessible from your EC2 instance's public IP
    app.run(host="0.0.0.0", port=5000, debug=True)
