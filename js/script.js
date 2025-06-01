const API_BASE_URL = ''; // Adjust if your API is on a different origin (e.g., 'http://<your_ec2_ip>:5000')
const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let currentUser = null; // To store { userId, username }

const dateElement = document.getElementById("date-info");
const timeElement = document.getElementById("time-info");
const taskTabsContainer = document.getElementById("task-tabs"); // Renamed for clarity from taskTabs
const tasksTabContent = document.getElementById("tasks-tab-content");
const submitTabBtn = document.getElementById("submit-tab");
const addTabForm = document.getElementById("add-tab-form"); // Ensure this ID exists if used
const addTaskBtn = document.getElementById("submit-task");
const taskInput = document.getElementById("task");
const taskDescriptionInput = document.getElementById("description");
const taskForm = document.querySelector("#add-task form"); // Ensure modal ID is 'add-task'
const importTasksBtn = document.getElementById("import-tasks-btn");
const taskFileInput = document.getElementById("task-file");
const userGreetingElement = document.getElementById("user-greeting"); // Assuming you add an element with this ID

// --- App Data (Client-side state) ---
let appData = {
	tabs: [],       // Will be array of objects: { tabId: "main", tabName: "Main" }
	activeTabId: "main",
	tasks: {},      // { tabId: [{ taskId, text, description, completed, ...otherPropsFromBackend }, ...] }
	loadedTasksForTabs: new Set() // To track which tabs have had their tasks loaded
};

// --- API Utility ---
async function fetchData(endpoint, method = 'GET', body = null, isFormData = false) {
	const options = {
		method,
		// credentials: 'include', // Important for session cookies if backend and frontend are on different origins
		// and CORS is configured correctly. For same-origin, this is not strictly needed
		// but good practice if you anticipate splitting origins.
	};
	if (body) {
		if (isFormData) {
			options.body = body; // FormData object
		} else {
			options.headers = { 'Content-Type': 'application/json' };
			options.body = JSON.stringify(body);
		}
	}

	try {
		const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
		if (response.status === 204) { // No Content
			return null;
		}
		const responseData = await response.json();
		if (!response.ok) {
			const errorMessage = responseData.message || responseData.error || `HTTP error! status: ${response.status}`;
			console.error(`API Error (${method} ${endpoint}):`, errorMessage, responseData);
			alert(`Error: ${errorMessage}`);
			if (response.status === 401) { // Unauthorized
				window.location.href = 'login.html'; // Redirect to login
			}
			return null; // Or throw new Error(errorMessage);
		}
		return responseData;
	} catch (error) {
		console.error(`Network/Fetch Error (${method} ${endpoint}):`, error);
		alert('A network error occurred. Please try again.');
		return null; // Or throw error;
	}
}

// --- Authentication ---
async function checkAuthAndInit() {
	const authStatus = await fetchData('/api/auth/status');
	if (authStatus && authStatus.isLoggedIn) {
		currentUser = { userId: authStatus.userId, username: authStatus.username };
		console.log('User logged in:', currentUser.username);
		if (userGreetingElement) { // Update greeting if element exists
			userGreetingElement.textContent = `Hi, ${currentUser.username}`;
		} else {
			// Find the h4 in the active tab and update it - this needs to be smarter
			// For now, let's assume you'll add a dedicated element in index.html:
			// e.g., <h4 class="fw-bold" id="user-greeting">Hi, User</h4>
			const mainTabGreeting = document.querySelector("#main-pane .tasks-section h4.fw-bold");
			if (mainTabGreeting) mainTabGreeting.textContent = `Hi, ${currentUser.username}`;
		}
		await initApp();
	} else {
		console.log('User not logged in. Redirecting to login page.');
		window.location.href = 'login.html';
	}
}

async function handleLogout() {
	const result = await fetchData('/api/auth/logout', 'POST');
	if (result) {
		currentUser = null;
		localStorage.removeItem('taskHiveUser'); // Clear any local user info
		appData = { tabs: [], activeTabId: "main", tasks: {}, loadedTasksForTabs: new Set() }; // Reset appData
		window.location.href = 'login.html';
	} else {
		alert('Logout failed. Please try again.');
	}
}


// --- Initialization ---
async function initApp() {
	day();
	time();
	setInterval(time, 60000);

	await loadInitialData(); // Load tabs and initial tasks
	addEventListeners();
	addFileImportListeners(); // Assuming this is still desired
	updateDeleteTabButtonVisibility(); // Handle delete button visibility based on active tab
}

async function loadInitialData() {
	// Fetch tabs from backend
	const fetchedTabs = await fetchData('/api/tabs'); // API endpoint needed: GET /api/tabs
	if (fetchedTabs && Array.isArray(fetchedTabs)) {
		appData.tabs = fetchedTabs; // Backend should return [{tabId, tabName}, ...]
		if (!appData.tabs.find(t => t.tabId === 'main')) { // Ensure main tab exists
			appData.tabs.unshift({ tabId: 'main', tabName: 'Main' });
		}
	} else {
		appData.tabs = [{ tabId: 'main', tabName: 'Main' }]; // Fallback
		alert('Failed to load tabs. Using default "Main" tab.');
	}

	renderTabs(); // Render all tabs from appData.tabs

	// Fetch user's active tab preference
	const activeTabPref = await fetchData('/api/user/preferences/active-tab'); // API endpoint needed
	if (activeTabPref && activeTabPref.activeTabId && appData.tabs.find(t => t.tabId === activeTabPref.activeTabId)) {
		appData.activeTabId = activeTabPref.activeTabId;
	} else {
		appData.activeTabId = 'main'; // Default if no preference or pref is invalid
	}

	// Activate the determined active tab
	const tabToActivate = document.getElementById(appData.activeTabId);
	if (tabToActivate) {
		try {
			const tab = new bootstrap.Tab(tabToActivate);
			tab.show(); // This will trigger 'shown.bs.tab'
		} catch (e) {
			console.warn("Bootstrap Tab API error on initial load, or tab not found for ID:", appData.activeTabId, e);
			// Fallback to ensuring tasks for 'main' are loaded if 'show' fails.
			if (appData.activeTabId !== 'main' && !appData.loadedTasksForTabs.has('main')) {
				await loadTasksForTab('main');
			}
		}
	} else {
		console.warn("Initial active tab element not found:", appData.activeTabId);
		// Ensure 'main' tab tasks are loaded if the preferred active tab isn't found.
		if (!appData.loadedTasksForTabs.has('main')) {
			await loadTasksForTab('main');
		}
	}
	// Note: 'shown.bs.tab' listener will call loadTasksForTab for the active tab.
}


// --- Tab Management ---
function renderTabs() {
	if (!taskTabsContainer) return;
	// Clear existing dynamic tabs (keep main tab if it's hardcoded in HTML)
	const dynamicTabs = taskTabsContainer.querySelectorAll("li:not(:first-child)"); // Assuming main is first
	dynamicTabs.forEach(li => {
		// Check if the tab button is the "add tab" button
		const button = li.querySelector('button');
		if (button && !button.querySelector('img[alt="Add Tab"]')) {
			li.remove();
		}
	});


	// The 'main' tab is in HTML. Render other tabs from appData.tabs
	appData.tabs.forEach(tabObj => {
		if (tabObj.tabId !== "main") { // 'main' is already in DOM
			createTabElement(tabObj.tabName, tabObj.tabId, false); // Don't auto-activate during initial render
		}
	});
}

function createTabElement(tabName, tabId, activateTab = false) {
	if (!taskTabsContainer || !tasksTabContent) return;

	// Check if tab already exists to prevent duplicates if called multiple times
	if (document.getElementById(tabId)) {
		console.warn(`Tab with ID ${tabId} already exists. Skipping creation.`);
		return;
	}

	const li = document.createElement("li");
	li.classList.add("nav-item");
	li.role = "presentation";

	const button = document.createElement("button");
	button.classList.add("nav-link", "me-2");
	button.id = tabId;
	button.setAttribute("data-bs-toggle", "tab");
	button.setAttribute("data-bs-target", `#${tabId}-pane`);
	button.type = "button";
	button.role = "tab";
	button.setAttribute("aria-controls", `${tabId}-pane`);
	button.setAttribute("aria-selected", activateTab.toString());
	button.textContent = tabName;

	li.appendChild(button);
	// Insert before the "Add Tab" button (which is assumed to be the last child's li)
	taskTabsContainer.insertBefore(li, taskTabsContainer.lastElementChild);

	const tabPane = document.createElement("div");
	tabPane.classList.add("tab-pane", "fade");
	if (activateTab) tabPane.classList.add("show", "active");
	tabPane.id = `${tabId}-pane`;
	tabPane.setAttribute("role", "tabpanel");
	tabPane.setAttribute("aria-labelledby", tabId);
	tabPane.tabIndex = 0;

	// Use the user's actual username
	const usernameForGreeting = currentUser ? currentUser.username : "User";

	tabPane.innerHTML = `
      <div class="row p-4 bg-content align-items-center">
        <div class="col-12 col-lg-5 p-0 px-lg-3 pb-5 text-center">
          <button class="btn btn-primary justify-item-center rounded-pill px-4 mb-4 mb-sm-0 me-2" data-bs-toggle="modal" data-bs-target="#add-task-modal">Add Task</button>
          <button class="btn btn-dark justify-item-center rounded-pill px-4" data-bs-toggle="modal" data-bs-target="#import-tasks-modal">Import Tasks</button>
        </div>
        <div class="offset-lg-1 col-lg-5 tasks-section" id="${tabId}-tasks-section">
          <h4 class="fw-bold user-greeting-tab">Hi, ${usernameForGreeting}</h4>
          <h3>You have <span id="${tabId}-counter">0 tasks</span></h3>
          <div class="progress-wrapper pt-4">
            <div class="d-flex justify-content-between">
              <p>Your progress</p>
              <p id="${tabId}-progress-percent">0%</p>
            </div>
            <div class="progress mb-4">
              <div id="${tabId}-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-warning"
                role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%">
              </div>
            </div>
          </div>
          <!-- Tasks will be rendered here by renderTasksForTab -->
        </div>
      </div>
    `;
	tasksTabContent.appendChild(tabPane);

	if (activateTab) {
		const tab = new bootstrap.Tab(button);
		tab.show();
		// 'shown.bs.tab' listener will handle loading tasks for this new active tab
	}
}

async function handleTabSubmission() {
	if (!submitTabBtn) return;
	const tabNameInput = document.getElementById("tab-name");
	const tabName = tabNameInput.value.trim();
	if (!tabName) {
		alert("Tab name cannot be empty.");
		return;
	}

	const newTab = await fetchData('/api/tabs', 'POST', { tabName });

	if (newTab && newTab.tabId) { // Backend should return the created tab {tabId, tabName}
		appData.tabs.push(newTab);
		appData.tasks[newTab.tabId] = []; // Initialize tasks for the new tab
		createTabElement(newTab.tabName, newTab.tabId, true); // Create and activate
		tabNameInput.value = "";
		const modal = bootstrap.Modal.getInstance(document.getElementById('add-tab-modal'));
		if (modal) modal.hide();
	} else {
		alert("Failed to create tab.");
	}
}

async function deleteTab() {
	if (appData.tabs.length <= 1 || appData.activeTabId === "main") {
		alert("Cannot delete the main tab!");
		return;
	}

	const tabIdToDelete = appData.activeTabId;
	if (!confirm(`Are you sure you want to delete the tab "${appData.tabs.find(t => t.tabId === tabIdToDelete)?.tabName || tabIdToDelete}" and all its tasks?`)) {
		return;
	}

	const result = await fetchData(`/api/tabs/${tabIdToDelete}`, 'DELETE');

	if (result !== null) { // fetchData returns null on 204 No Content, which is success for DELETE
		const tabElement = document.getElementById(tabIdToDelete);
		const tabContent = document.getElementById(`${tabIdToDelete}-pane`);
		if (tabElement) tabElement.closest('li.nav-item').remove(); // Remove the <li>
		if (tabContent) tabContent.remove();

		appData.tabs = appData.tabs.filter(tab => tab.tabId !== tabIdToDelete);
		delete appData.tasks[tabIdToDelete];
		appData.loadedTasksForTabs.delete(tabIdToDelete);


		appData.activeTabId = "main"; // Default to main
		const mainTabElement = document.getElementById("main");
		if (mainTabElement) {
			const tab = new bootstrap.Tab(mainTabElement);
			tab.show(); // This will trigger 'shown.bs.tab' which loads tasks for main
		}
		updateDeleteTabButtonVisibility();
	} else {
		alert("Failed to delete tab.");
	}
}


// --- Task Management ---
async function loadTasksForTab(tabId) {
	if (!tabId) {
		console.error("loadTasksForTab called with no tabId");
		return;
	}
	console.log(`Loading tasks for tab: ${tabId}`);
	// Fetch tasks for this tab from backend
	// The API endpoint now includes tabId: /api/tasks/{tabId}
	const fetchedTasks = await fetchData(`/api/tasks/${tabId}`);

	if (fetchedTasks && Array.isArray(fetchedTasks)) {
		appData.tasks[tabId] = fetchedTasks; // Backend returns array of task objects
		appData.loadedTasksForTabs.add(tabId);
		renderTasksForTab(tabId);
	} else if (fetchedTasks === null && !appData.tasks[tabId]) {
		// If API call was successful but returned null (e.g. 204 or failed parsing) and no tasks are locally stored
		// This could happen if fetchData returns null for a non-204 error that it caught
		console.warn(`No tasks found or error loading tasks for tab ${tabId}. Initializing empty.`);
		appData.tasks[tabId] = [];
		appData.loadedTasksForTabs.add(tabId);
		renderTasksForTab(tabId); // Render empty state
	} else if (!fetchedTasks && !appData.tasks[tabId]) {
		// If API call failed entirely (fetchData returned null from its catch block)
		console.error(`Failed to load tasks for tab ${tabId}.`);
		appData.tasks[tabId] = []; // Initialize as empty to prevent errors
		renderTasksForTab(tabId); // Still try to render (empty)
	}
	// If tasks are already in appData.tasks[tabId] from a previous load,
	// and fetchedTasks is null due to an error, we might opt not to clear them
	// or to show an error without clearing. For now, this handles initial load/error.
}

function renderTasksForTab(tabId) {
	const tasksSection = document.getElementById(`${tabId}-tasks-section`);
	if (!tasksSection) {
		console.warn(`Tasks section for tab ${tabId} not found in DOM.`);
		return;
	}

	// Clear existing tasks from DOM for this tab before re-rendering
	const existingTaskElements = tasksSection.querySelectorAll(".form-check");
	existingTaskElements.forEach(taskEl => taskEl.remove());
	const existingDescriptions = tasksSection.querySelectorAll(".collapse.task-description-custom"); // Custom class for easier selection
	existingDescriptions.forEach(descEl => descEl.remove());


	if (appData.tasks[tabId] && appData.tasks[tabId].length > 0) {
		appData.tasks[tabId].forEach(taskObject => {
			// taskObject from backend should be like: { taskId, text, description, completed, createdAt, updatedAt }
			createTaskElement(tasksSection, taskObject);
		});
	} else {
		// Optionally, display a "No tasks yet" message
		// For now, it will just be empty.
	}
	updateCounterForTab(tabId);
	updateProgressbarForTab(tabId); // Make sure this uses appData
}

function createTaskElement(tasksSection, taskObject) { // taskObject from backend
	const { taskId, text, description, completed } = taskObject;

	const formCheck = document.createElement("div");
	formCheck.classList.add("form-check", "pb-3", "position-relative");
	formCheck.setAttribute("data-task-id", taskId); // Store taskId

	const taskCheckbox = document.createElement("input");
	taskCheckbox.type = "checkbox";
	taskCheckbox.checked = completed;
	taskCheckbox.classList.add("form-check-input");
	taskCheckbox.id = `task-check-${taskId}`;
	taskCheckbox.addEventListener("change", function() {
		toggleTask(this, tabId, taskId); // Pass tabId and taskId
	});


	const taskCheckLabel = document.createElement("label");
	taskCheckLabel.textContent = text;
	taskCheckLabel.classList.add("form-check-label", "ps-4");
	taskCheckLabel.setAttribute("for", `task-check-${taskId}`);
	if (completed) {
		taskCheckLabel.style.textDecoration = "line-through";
	}

	const closeButton = document.createElement("button");
	closeButton.innerHTML = "×"; // Or use a trash icon
	closeButton.classList.add("btn", "btn-sm", "btn-outline-danger", "rounded-pill", "px-2", "py-0", "position-absolute", "end-0", "top-0", "remove-task");
	closeButton.style.fontSize = "1.2em";
	closeButton.setAttribute("aria-label", "Remove task");
	closeButton.addEventListener("click", function() {
		removeTask(this.closest('.form-check'), appData.activeTabId, taskId); // Pass task element, tabId, taskId
	});


	formCheck.appendChild(taskCheckbox);
	formCheck.appendChild(taskCheckLabel);
	formCheck.appendChild(closeButton);

	if (description) {
		const descDivId = `task-desc-${taskId}`;
		const taskDescriptionDiv = document.createElement("div");
		taskDescriptionDiv.textContent = description;
		taskDescriptionDiv.id = descDivId;
		taskDescriptionDiv.classList.add("collapse", "pt-1", "ps-5", "fst-italic", "text-muted", "small", "task-description-custom"); // Added custom class

		taskCheckLabel.setAttribute("data-bs-toggle", "collapse"); // Make label clickable to toggle
		taskCheckLabel.setAttribute("data-bs-target", `#${descDivId}`);
		taskCheckLabel.style.cursor = "pointer"; // Indicate it's clickable

		formCheck.appendChild(taskDescriptionDiv);
	}
	tasksSection.appendChild(formCheck);
	return formCheck;
}


async function handleTaskSubmission() {
	const taskName = taskInput.value.trim();
	if (taskName === "") {
		alert("Task name cannot be empty.");
		return;
	}
	const description = taskDescriptionInput.value.trim();
	const activeTabId = appData.activeTabId;

	const newTaskData = {
		tabId: activeTabId, // API expects tabId in body
		text: taskName,
		description: description
	};

	// API endpoint: POST /api/tasks (Flask route doesn't take tabId in URL for POST)
	const createdTask = await fetchData('/api/tasks', 'POST', newTaskData);

	if (createdTask && createdTask.taskId) {
		if (!appData.tasks[activeTabId]) {
			appData.tasks[activeTabId] = [];
		}
		appData.tasks[activeTabId].push(createdTask); // Add the full task object from backend

		const tasksSection = document.getElementById(`${activeTabId}-tasks-section`);
		if (tasksSection) {
			createTaskElement(tasksSection, createdTask); // Render the new task
		}
		updateCounterForTab(activeTabId);
		updateProgressbarForTab(activeTabId);

		taskInput.value = "";
		taskDescriptionInput.value = "";
		const modal = bootstrap.Modal.getInstance(document.getElementById('add-task-modal')); // Ensure modal ID is add-task-modal
		if (modal) modal.hide();
	} else {
		alert("Failed to add task.");
	}
}

async function toggleTask(checkboxElement, tabId, taskId) {
	const isCompleted = checkboxElement.checked;
	const label = checkboxElement.nextElementSibling; // Assuming label is the next sibling

	// API endpoint: PUT /api/tasks/{tabId}/{taskId}
	const updatedTask = await fetchData(`/api/tasks/${tabId}/${taskId}`, 'PUT', { completed: isCompleted });

	if (updatedTask) {
		if (label) {
			label.style.textDecoration = isCompleted ? "line-through" : "none";
		}
		// Update appData
		const taskIndex = appData.tasks[tabId]?.findIndex(t => t.taskId === taskId);
		if (taskIndex !== -1 && appData.tasks[tabId]) {
			appData.tasks[tabId][taskIndex].completed = isCompleted;
			appData.tasks[tabId][taskIndex].updatedAt = updatedTask.updatedAt; // Sync updatedAt
		}
		updateProgressbarForTab(tabId);
	} else {
		alert("Failed to update task status.");
		checkboxElement.checked = !isCompleted; // Revert UI change on failure
	}
}

async function removeTask(taskElement, tabId, taskId) {
	if (!confirm("Are you sure you want to remove this task?")) return;

	// API endpoint: DELETE /api/tasks/{tabId}/{taskId}
	const success = await fetchData(`/api/tasks/${tabId}/${taskId}`, 'DELETE');

	if (success !== null) { // fetchData returns null on 204 No Content (success for DELETE)
		taskElement.remove();
		// Update appData
		if (appData.tasks[tabId]) {
			appData.tasks[tabId] = appData.tasks[tabId].filter(t => t.taskId !== taskId);
		}
		updateCounterForTab(tabId);
		updateProgressbarForTab(tabId);
	} else {
		alert("Failed to remove task.");
	}
}


// --- UI Updates (Counters, Progress) ---
function updateCounterForTab(tabId) {
	const counterElement = document.getElementById(`${tabId}-counter`);
	if (!counterElement) return;

	const taskCount = appData.tasks[tabId] ? appData.tasks[tabId].length : 0;
	counterElement.textContent = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
}

function updateProgressbarForTab(tabId) {
	const progressBar = document.getElementById(`${tabId}-progress-bar`);
	const progressPercentText = document.getElementById(`${tabId}-progress-percent`);
	if (!progressBar || !progressPercentText) return;

	const tasksInTab = appData.tasks[tabId] || [];
	const completedCount = tasksInTab.filter(task => task.completed).length;
	const totalTasks = tasksInTab.length;
	const progress = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

	progressBar.style.width = `${progress}%`;
	progressBar.setAttribute("aria-valuenow", progress);
	progressPercentText.textContent = `${progress}%`;
}

// --- Date & Time ---
function time() {
	if (!timeElement) return;
	const now = new Date();
	let hours = now.getHours();
	const min = now.getMinutes();
	const meridiem = hours >= 12 ? "PM" : "AM";
	hours = hours % 12 || 12;
	timeElement.textContent = `${hours}:${min < 10 ? '0' : ''}${min} ${meridiem}`;
}

function day() {
	if (!dateElement) return;
	const now = new Date();
	dateElement.textContent = `${weekday[now.getDay()]}, ${now.toLocaleDateString()}`;
}

// --- Import Tasks ---
async function importTasksFromFile() {
	if (!importTasksBtn || !taskFileInput) return; // Safety check
	const file = taskFileInput.files[0];
	const markCompleted = document.getElementById("mark-completed").checked;

	if (!file) {
		alert("Please select a file to import.");
		return;
	}

	const reader = new FileReader();
	reader.onload = async function(e) {
		const contents = e.target.result;
		const lines = contents.split('\n').filter(line => line.trim() !== '');
		const activeTabId = appData.activeTabId;
		let importCount = 0;
		let allImportApiCalls = [];

		lines.forEach(line => {
			const parts = line.split('|').map(part => part.trim());
			const taskName = parts[0];
			const description = parts.length > 1 ? parts[1] : '';

			if (taskName) {
				// For import, we send completed status directly
				const taskData = { tabId: activeTabId, text: taskName, description, completed: markCompleted };
				// Queue API call
				allImportApiCalls.push(fetchData('/api/tasks', 'POST', taskData));
				importCount++;
			}
		});

		if (allImportApiCalls.length > 0) {
			try {
				const results = await Promise.all(allImportApiCalls);
				let successfulImports = 0;
				results.forEach(createdTask => {
					if (createdTask && createdTask.taskId) {
						if (!appData.tasks[activeTabId]) appData.tasks[activeTabId] = [];
						appData.tasks[activeTabId].push(createdTask);
						successfulImports++;
					}
				});

				if (successfulImports > 0) {
					renderTasksForTab(activeTabId); // Re-render tasks for the current tab
				}
				alert(`Successfully imported ${successfulImports} of ${importCount} tasks.`);

			} catch (error) {
				console.error("Error during batch task import:", error);
				alert("Some tasks may not have been imported due to an error.");
				// Partial success might have occurred, so still good to refresh tasks
				await loadTasksForTab(activeTabId); // Refresh tasks from server
			}
		}


		bootstrap.Modal.getInstance(document.getElementById('import-tasks-modal'))?.hide();
		taskFileInput.value = '';
		document.getElementById("mark-completed").checked = false;
	};
	reader.onerror = function() { alert('Error reading file'); };
	reader.readAsText(file);
}

function addFileImportListeners() {
	if (importTasksBtn) importTasksBtn.addEventListener("click", importTasksFromFile);
	// File input change listener seems to be missing or was not part of the original functional requirement for backend.
	// If it's for UI display of filename, it can remain.
}

// --- Event Listeners Setup ---
function addEventListeners() {
	if (submitTabBtn) {
		submitTabBtn.addEventListener("click", function(event) {
			event.preventDefault();
			handleTabSubmission();
		});
	}
	if (document.getElementById("tab-name")) { // For Enter key in add tab modal
		document.getElementById("tab-name").addEventListener("keydown", function(event) {
			if (event.key === "Enter") {
				event.preventDefault();
				handleTabSubmission();
			}
		});
	}


	if (addTaskBtn) {
		addTaskBtn.addEventListener("click", function(event) {
			event.preventDefault();
			handleTaskSubmission();
		});
	}
	// Enter key for task inputs (assuming taskInput and taskDescriptionInput are correct)
	[taskInput, taskDescriptionInput].forEach(inputEl => {
		if (inputEl) {
			inputEl.addEventListener("keydown", function(event) {
				if (event.key === "Enter" && !event.shiftKey) { // Allow Shift+Enter for new lines in textarea
					if (inputEl.tagName.toLowerCase() === 'textarea' && event.shiftKey) {
						return; // Allow default behavior for Shift+Enter in textarea
					}
					event.preventDefault();
					handleTaskSubmission();
				}
			});
		}
	});

	// Listener for Bootstrap tab shown event
	document.addEventListener('shown.bs.tab', async function(event) {
		const newActiveTabId = event.target.id; // e.g., "main", "work-tab"
		if (newActiveTabId && appData.activeTabId !== newActiveTabId) {
			appData.activeTabId = newActiveTabId;
			console.log("Active tab changed to:", appData.activeTabId);

			// Persist active tab preference to backend (optional, but good for UX)
			// You'll need a backend endpoint for this: PUT /api/user/preferences/active-tab
			await fetchData('/api/user/preferences/active-tab', 'PUT', { activeTabId: newActiveTabId });


			// Load tasks for the new active tab if not already loaded
			if (!appData.loadedTasksForTabs.has(newActiveTabId)) {
				await loadTasksForTab(newActiveTabId);
			} else {
				// Tasks already loaded, just ensure UI (counters, progress) is up-to-date for this tab
				// This might be redundant if renderTasksForTab already calls them, but good for safety.
				updateCounterForTab(newActiveTabId);
				updateProgressbarForTab(newActiveTabId);
			}
			updateDeleteTabButtonVisibility();
		}
	});

	// Delete Tab button (assuming you add one with id="delete-tab-button")
	const deleteTabGlobalBtn = document.getElementById("delete-tab-button"); // This needs to be added to index.html
	if (deleteTabGlobalBtn) {
		deleteTabGlobalBtn.addEventListener("click", deleteTab);
	}
}

function updateDeleteTabButtonVisibility() {
	const deleteTabGlobalBtn = document.getElementById("delete-tab-button");
	if (deleteTabGlobalBtn) {
		if (appData.activeTabId === "main" || appData.tabs.length <= 1) {
			deleteTabGlobalBtn.style.display = "none";
		} else {
			deleteTabGlobalBtn.style.display = "inline-block"; // Or "block", "flex", etc.
		}
	}
}


// --- Start the App ---
document.addEventListener('DOMContentLoaded', checkAuthAndInit);
