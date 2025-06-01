// --- Globals & Constants ---
const API_BASE_URL = ''; // Adjust if API is on a different origin (e.g., 'http://<your_ec2_ip>:5000')
const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let currentUser = null; // To store { userId, username }

// --- DOM Elements ---
const dateElement = document.getElementById("date-info");
const timeElement = document.getElementById("time-info");
const taskTabsContainer = document.getElementById("task-tabs");
const tasksTabContent = document.getElementById("tasks-tab-content");

const addTabModalEl = document.getElementById('add-tab-modal');
const submitTabBtn = document.getElementById("submit-tab");
// const addTabForm = document.getElementById("add-tab-form"); // Not directly used for submission logic

const addTaskModalEl = document.getElementById('add-task-modal');
const addTaskBtn = document.getElementById("submit-task"); // Button in add task modal
const taskInput = document.getElementById("task");
const taskDescriptionInput = document.getElementById("description");
// const taskForm = document.querySelector("#add-task-modal form"); // If you need the form element itself

const importTasksBtn = document.getElementById("import-tasks-btn");
const taskFileInput = document.getElementById("task-file");
const importTasksModalEl = document.getElementById('import-tasks-modal');

const logoutButton = document.getElementById("logout-button");
const deleteTabGlobalBtn = document.getElementById("delete-tab-button");


// --- App Data (Client-side state) ---
let appData = {
	tabs: [],       // Array of objects: { tabId: "main", tabName: "Main", ...other props from backend }
	activeTabId: "main",
	tasks: {},      // { tabId: [{ taskId, text, description, completed, ... }, ...] }
	loadedTasksForTabs: new Set() // To track which tabs have had their tasks loaded
};

// --- API Utility ---
async function fetchData(endpoint, method = 'GET', body = null, isFormData = false) {
	const options = {
		method,
		credentials: 'include', // Send cookies for session-based auth, even cross-origin (if CORS allows)
	};
	if (body) {
		if (isFormData) {
			options.body = body;
		} else {
			options.headers = { ...options.headers, 'Content-Type': 'application/json' };
			options.body = JSON.stringify(body);
		}
	}

	try {
		const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
		if (response.status === 204) { // No Content
			return { success: true, data: null }; // Indicate success for DELETE or no-content PUTs
		}
		const responseData = await response.json();
		if (!response.ok) {
			const errorMessage = responseData.message || responseData.error || `HTTP error! status: ${response.status}`;
			console.error(`API Error (${method} ${endpoint}):`, errorMessage, responseData);
			alert(`Error: ${errorMessage}`);
			if (response.status === 401) {
				window.location.href = 'login.html';
			}
			return { success: false, error: errorMessage, data: responseData };
		}
		return { success: true, data: responseData };
	} catch (error) {
		console.error(`Network/Fetch Error (${method} ${endpoint}):`, error);
		alert('A network error occurred. Please try again.');
		return { success: false, error: 'Network error', data: null };
	}
}

// --- Authentication ---
async function checkAuthAndInit() {
	const result = await fetchData('/api/auth/status');
	if (result.success && result.data && result.data.isLoggedIn) {
		currentUser = { userId: result.data.userId, username: result.data.username };
		console.log('User logged in:', currentUser.username);
		updateAllUserGreetings(currentUser.username);
		await initApp();
	} else {
		console.log('User not logged in. Redirecting to login page.');
		window.location.href = 'login.html';
	}
}

async function handleLogout() {
	const result = await fetchData('/api/auth/logout', 'POST');
	// Logout should succeed even if the session was already invalid on server
	// The key is to clear client-side state and redirect.
	currentUser = null;
	localStorage.removeItem('taskHiveUser'); // Just in case it was used
	appData = { tabs: [], activeTabId: "main", tasks: {}, loadedTasksForTabs: new Set() };
	window.location.href = '/login';
	if (!result.success) { // Log if backend had an issue, but still log out client-side
		console.warn("Logout API call reported an issue, but proceeding with client-side logout.", result.error);
	}
}

function updateAllUserGreetings(username) {
	const greetingElements = document.querySelectorAll('.user-greeting-tab');
	greetingElements.forEach(el => {
		el.textContent = `Hi, ${username || 'User'}`;
	});
}

// --- Initialization ---
async function initApp() {
	day();
	time();
	setInterval(time, 60000);

	await loadInitialData();
	addEventListeners(); // All general event listeners
	addFileImportListeners();
	updateDeleteTabButtonVisibility();
}

async function loadInitialData() {
	const tabsResult = await fetchData('/api/tabs');
	if (tabsResult.success && tabsResult.data && Array.isArray(tabsResult.data)) {
		appData.tabs = tabsResult.data;
		if (!appData.tabs.find(t => t.tabId === 'main')) {
			appData.tabs.unshift({ tabId: 'main', tabName: 'Main' });
		}
	} else {
		appData.tabs = [{ tabId: 'main', tabName: 'Main' }];
		alert('Failed to load tabs. Using default "Main" tab.');
	}
	renderTabs();

	const activeTabPrefResult = await fetchData('/api/user/preferences/active-tab');
	if (activeTabPrefResult.success && activeTabPrefResult.data && activeTabPrefResult.data.activeTabId &&
		appData.tabs.find(t => t.tabId === activeTabPrefResult.data.activeTabId)) {
		appData.activeTabId = activeTabPrefResult.data.activeTabId;
	} else {
		appData.activeTabId = 'main';
	}

	const tabToActivateButton = document.getElementById(appData.activeTabId);
	if (tabToActivateButton) {
		try {
			const tab = new bootstrap.Tab(tabToActivateButton);
			tab.show(); // This will trigger 'shown.bs.tab' handled in addEventListeners
		} catch (e) {
			console.warn("Bootstrap Tab API error on initial load for ID:", appData.activeTabId, e);
			if (appData.activeTabId !== 'main' && !appData.loadedTasksForTabs.has('main')) {
				await loadTasksForTab('main'); // Fallback to load main tab's tasks
			} else if (appData.activeTabId === 'main' && !appData.loadedTasksForTabs.has('main')) {
				await loadTasksForTab('main'); // Ensure main tasks load if it's active and not loaded
			}
		}
	} else {
		console.warn("Initial active tab button not found:", appData.activeTabId);
		if (!appData.loadedTasksForTabs.has('main')) { // Ensure main tab tasks load if preferred not found
			await loadTasksForTab('main');
		}
	}
}

// --- Tab Management ---
function renderTabs() {
	if (!taskTabsContainer) return;
	const allTabLis = Array.from(taskTabsContainer.querySelectorAll("li.nav-item"));
	allTabLis.forEach(li => {
		const buttonElement = li.querySelector('button.nav-link');
		if (buttonElement) {
			const isMainTab = buttonElement.id === 'main';
			const isAddTabButton = buttonElement.getAttribute('data-bs-target') === '#add-tab-modal';
			if (!isMainTab && !isAddTabButton) {
				li.remove();
			}
		}
	});

	appData.tabs.forEach(tabObj => {
		if (tabObj.tabId !== "main") {
			if (!document.getElementById(tabObj.tabId)) {
				createTabElement(tabObj.tabName, tabObj.tabId, false);
			}
		}
	});
	updateDeleteTabButtonVisibility(); // Update after rendering
}

function createTabElement(tabName, tabId, activateTab = false) {
	if (!taskTabsContainer || !tasksTabContent) return;
	if (document.getElementById(tabId)) {
		console.warn(`Tab element with ID ${tabId} already exists. Skipping creation.`);
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
	taskTabsContainer.insertBefore(li, taskTabsContainer.lastElementChild); // Insert before "Add Tab" button's li

	const tabPane = document.createElement("div");
	tabPane.classList.add("tab-pane", "fade");
	if (activateTab) tabPane.classList.add("show", "active");
	tabPane.id = `${tabId}-pane`;
	tabPane.setAttribute("role", "tabpanel");
	tabPane.setAttribute("aria-labelledby", tabId);
	tabPane.tabIndex = 0;
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
            <div class="d-flex justify-content-between"> <p>Your progress</p> <p id="${tabId}-progress-percent">0%</p> </div>
            <div class="progress mb-4">
              <div id="${tabId}-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-warning"
                role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%"></div>
            </div>
          </div>
        </div>
      </div>`;
	tasksTabContent.appendChild(tabPane);

	if (activateTab) {
		const newBootstrapTab = new bootstrap.Tab(button);
		newBootstrapTab.show(); // Triggers 'shown.bs.tab'
	}
}

async function handleTabSubmission() {
	const tabNameInput = document.getElementById("tab-name");
	if (!tabNameInput) return;
	const tabName = tabNameInput.value.trim();
	if (!tabName) {
		alert("Tab name cannot be empty.");
		return;
	}

	const result = await fetchData('/api/tabs', 'POST', { tabName });
	if (result.success && result.data && result.data.tabId) {
		const newTab = result.data;
		if (!appData.tabs.find(t => t.tabId === newTab.tabId)) {
			appData.tabs.push(newTab);
		}
		appData.tasks[newTab.tabId] = [];
		createTabElement(newTab.tabName, newTab.tabId, true);
		tabNameInput.value = "";
		bootstrap.Modal.getInstance(addTabModalEl)?.hide();
	} else {
		alert(result.error || "Failed to create tab.");
	}
}

async function deleteTab() {
	if (appData.tabs.length <= 1 || appData.activeTabId === "main") {
		alert("Cannot delete the main tab!");
		return;
	}
	const tabIdToDelete = appData.activeTabId;
	const tabNameToDelete = appData.tabs.find(t => t.tabId === tabIdToDelete)?.tabName || tabIdToDelete;
	if (!confirm(`Are you sure you want to delete the tab "${tabNameToDelete}" and all its tasks?`)) {
		return;
	}

	const result = await fetchData(`/api/tabs/${tabIdToDelete}`, 'DELETE');
	if (result.success) { // Success for DELETE (even if null data for 204)
		const tabElement = document.getElementById(tabIdToDelete);
		const tabContent = document.getElementById(`${tabIdToDelete}-pane`);
		if (tabElement) tabElement.closest('li.nav-item')?.remove();
		if (tabContent) tabContent.remove();

		appData.tabs = appData.tabs.filter(tab => tab.tabId !== tabIdToDelete);
		delete appData.tasks[tabIdToDelete];
		appData.loadedTasksForTabs.delete(tabIdToDelete);

		appData.activeTabId = "main";
		const mainTabButton = document.getElementById("main");
		if (mainTabButton) {
			const tab = new bootstrap.Tab(mainTabButton);
			tab.show(); // Triggers 'shown.bs.tab'
		}
		updateDeleteTabButtonVisibility(); // Update after changing active tab and tabs list
	} else {
		alert(result.error || "Failed to delete tab.");
	}
}

// --- Task Management ---
async function loadTasksForTab(tabId) {
	if (!tabId) { console.error("loadTasksForTab: tabId is null or undefined"); return; }
	console.log(`Loading tasks for tab: ${tabId}`);
	const result = await fetchData(`/api/tasks/${tabId}`);

	if (result.success && result.data && Array.isArray(result.data)) {
		appData.tasks[tabId] = result.data;
	} else if (result.success && result.data === null) { // Explicitly no tasks, or 204
		appData.tasks[tabId] = [];
	} else {
		console.error(`Failed to load tasks for tab ${tabId}. Error: ${result.error}`);
		if (!appData.tasks[tabId]) appData.tasks[tabId] = []; // Ensure array exists to prevent UI errors
		// Optionally alert user about task loading failure
	}
	appData.loadedTasksForTabs.add(tabId);
	renderTasksForTab(tabId);
}

function renderTasksForTab(tabId) {
	const tasksSection = document.getElementById(`${tabId}-tasks-section`);
	if (!tasksSection) { console.warn(`Tasks section for tab ${tabId} not found.`); return; }

	const taskElementsContainer = tasksSection.querySelector('.progress-wrapper')?.nextElementSibling || tasksSection;
	// Clear existing task elements more carefully
	let currentElement = taskElementsContainer.firstChild;
	while (currentElement) {
		let nextElement = currentElement.nextSibling;
		if (currentElement.classList && currentElement.classList.contains('form-check')) {
			currentElement.remove();
		}
		currentElement = nextElement;
	}


	if (appData.tasks[tabId] && appData.tasks[tabId].length > 0) {
		appData.tasks[tabId].forEach(taskObject => {
			createTaskElement(taskElementsContainer, taskObject, tabId); // Pass tabId
		});
	}
	updateCounterForTab(tabId);
	updateProgressbarForTab(tabId);
}

function createTaskElement(tasksContainer, taskObject, currentTabId) {
	const { taskId, text, description, completed } = taskObject;
	const formCheck = document.createElement("div");
	formCheck.classList.add("form-check", "pb-3", "position-relative");
	formCheck.setAttribute("data-task-id", taskId);

	const taskCheckbox = document.createElement("input");
	taskCheckbox.type = "checkbox";
	taskCheckbox.checked = completed;
	taskCheckbox.classList.add("form-check-input");
	taskCheckbox.id = `task-check-${taskId}`;
	taskCheckbox.addEventListener("change", function() { toggleTask(this, currentTabId, taskId); });

	const taskCheckLabel = document.createElement("label");
	taskCheckLabel.textContent = text;
	taskCheckLabel.classList.add("form-check-label", "ps-4");
	taskCheckLabel.setAttribute("for", `task-check-${taskId}`);
	if (completed) taskCheckLabel.style.textDecoration = "line-through";

	const closeButton = document.createElement("button");
	closeButton.innerHTML = "×";
	closeButton.classList.add("btn", "btn-sm", "btn-outline-danger", "rounded-pill", "px-2", "py-0", "position-absolute", "end-0", "top-0", "remove-task");
	closeButton.style.fontSize = "1.2em";
	closeButton.setAttribute("aria-label", "Remove task");
	closeButton.addEventListener("click", function() { removeTask(this.closest('.form-check'), currentTabId, taskId); });

	formCheck.appendChild(taskCheckbox);
	formCheck.appendChild(taskCheckLabel);
	formCheck.appendChild(closeButton);

	if (description) {
		const descDivId = `task-desc-${taskId}`;
		const taskDescriptionDiv = document.createElement("div");
		taskDescriptionDiv.textContent = description;
		taskDescriptionDiv.id = descDivId;
		taskDescriptionDiv.classList.add("collapse", "pt-1", "ps-5", "fst-italic", "text-muted", "small", "task-description-custom");
		taskCheckLabel.setAttribute("data-bs-toggle", "collapse");
		taskCheckLabel.setAttribute("data-bs-target", `#${descDivId}`);
		taskCheckLabel.style.cursor = "pointer";
		formCheck.appendChild(taskDescriptionDiv);
	}
	// Append to the tasksContainer (which is tasksSection or a specific part of it)
	if (tasksContainer.classList.contains('tasks-section')) {
		// If it's the main tasks-section, append after the progress wrapper
		const progressWrapper = tasksContainer.querySelector('.progress-wrapper');
		if (progressWrapper) {
			progressWrapper.parentNode.insertBefore(formCheck, progressWrapper.nextSibling);
		} else {
			tasksContainer.appendChild(formCheck);
		}
	} else {
		tasksContainer.appendChild(formCheck); // Fallback if no progress wrapper
	}
	return formCheck;
}

async function handleTaskSubmission() {
	const taskName = taskInput.value.trim();
	if (taskName === "") { alert("Task name cannot be empty."); return; }
	const description = taskDescriptionInput.value.trim();
	const activeTabId = appData.activeTabId;
	const newTaskData = { tabId: activeTabId, text: taskName, description: description };

	const result = await fetchData('/api/tasks', 'POST', newTaskData);
	if (result.success && result.data && result.data.taskId) {
		const createdTask = result.data;
		if (!appData.tasks[activeTabId]) appData.tasks[activeTabId] = [];
		appData.tasks[activeTabId].push(createdTask);

		const tasksContainer = document.getElementById(`${activeTabId}-tasks-section`);
		if (tasksContainer) {
			// Use the same logic as renderTasksForTab for appending
			const progressWrapper = tasksContainer.querySelector('.progress-wrapper');
			const targetContainer = progressWrapper ? progressWrapper.parentNode : tasksContainer;
			createTaskElement(targetContainer, createdTask, activeTabId);
		}
		updateCounterForTab(activeTabId);
		updateProgressbarForTab(activeTabId);
		taskInput.value = "";
		taskDescriptionInput.value = "";
		bootstrap.Modal.getInstance(addTaskModalEl)?.hide();
	} else {
		alert(result.error || "Failed to add task.");
	}
}

async function toggleTask(checkboxElement, tabId, taskId) {
	const isCompleted = checkboxElement.checked;
	const label = checkboxElement.nextElementSibling;
	const result = await fetchData(`/api/tasks/${tabId}/${taskId}`, 'PUT', { completed: isCompleted });

	if (result.success && result.data) {
		const updatedTask = result.data;
		if (label) label.style.textDecoration = isCompleted ? "line-through" : "none";
		const taskIndex = appData.tasks[tabId]?.findIndex(t => t.taskId === taskId);
		if (taskIndex !== -1 && appData.tasks[tabId]) {
			appData.tasks[tabId][taskIndex].completed = isCompleted;
			appData.tasks[tabId][taskIndex].updatedAt = updatedTask.updatedAt;
		}
		updateProgressbarForTab(tabId);
	} else {
		alert(result.error || "Failed to update task status.");
		checkboxElement.checked = !isCompleted;
		if (label) label.style.textDecoration = !isCompleted ? "line-through" : "none";
	}
}

async function removeTask(taskElement, tabId, taskId) {
	if (!confirm("Are you sure you want to remove this task?")) return;
	const result = await fetchData(`/api/tasks/${tabId}/${taskId}`, 'DELETE');
	if (result.success) { // DELETE returns success even with null data (204)
		taskElement.remove();
		if (appData.tasks[tabId]) {
			appData.tasks[tabId] = appData.tasks[tabId].filter(t => t.taskId !== taskId);
		}
		updateCounterForTab(tabId);
		updateProgressbarForTab(tabId);
	} else {
		alert(result.error || "Failed to remove task.");
	}
}

// --- UI Updates ---
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
	if (!taskFileInput) return;
	const file = taskFileInput.files[0];
	const markCompleted = document.getElementById("mark-completed")?.checked || false;
	if (!file) { alert("Please select a file to import."); return; }

	const reader = new FileReader();
	reader.onload = async function(e) {
		const contents = e.target.result;
		const lines = contents.split('\n').filter(line => line.trim() !== '');
		const activeTabId = appData.activeTabId;
		let importCount = 0;
		const allImportPromises = [];

		lines.forEach(line => {
			const parts = line.split('|').map(part => part.trim());
			const taskName = parts[0];
			const description = parts.length > 1 ? parts[1] : '';
			if (taskName) {
				const taskData = { tabId: activeTabId, text: taskName, description, completed: markCompleted };
				allImportPromises.push(fetchData('/api/tasks', 'POST', taskData));
				importCount++;
			}
		});

		if (allImportPromises.length > 0) {
			const results = await Promise.all(allImportPromises);
			let successfulImports = 0;
			results.forEach(result => {
				if (result.success && result.data && result.data.taskId) {
					if (!appData.tasks[activeTabId]) appData.tasks[activeTabId] = [];
					appData.tasks[activeTabId].push(result.data);
					successfulImports++;
				} else {
					console.error("Failed to import a task:", result.error || "Unknown error");
				}
			});
			if (successfulImports > 0) renderTasksForTab(activeTabId);
			alert(`Successfully imported ${successfulImports} of ${importCount} tasks.`);
		}
		bootstrap.Modal.getInstance(importTasksModalEl)?.hide();
		taskFileInput.value = '';
		if (document.getElementById("mark-completed")) document.getElementById("mark-completed").checked = false;
	};
	reader.onerror = function() { alert('Error reading file'); };
	reader.readAsText(file);
}

function addFileImportListeners() {
	if (importTasksBtn) importTasksBtn.addEventListener("click", importTasksFromFile);
}

// --- Event Listeners Setup ---
function addEventListeners() {
	if (submitTabBtn) {
		submitTabBtn.addEventListener("click", (e) => { e.preventDefault(); handleTabSubmission(); });
	}
	const tabNameInput = document.getElementById("tab-name");
	if (tabNameInput) {
		tabNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); handleTabSubmission(); } });
	}
	if (addTaskBtn) {
		addTaskBtn.addEventListener("click", (e) => { e.preventDefault(); handleTaskSubmission(); });
	}
	[taskInput, taskDescriptionInput].forEach(inputEl => {
		if (inputEl) {
			inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !(inputEl.tagName.toLowerCase() === 'textarea' && e.shiftKey)) {
					e.preventDefault(); handleTaskSubmission();
				}
			});
		}
	});

	document.addEventListener('shown.bs.tab', async function(event) {
		const newActiveTabId = event.target.id;
		if (newActiveTabId && appData.activeTabId !== newActiveTabId) {
			appData.activeTabId = newActiveTabId;
			console.log("Active tab changed to:", appData.activeTabId);
			await fetchData('/api/user/preferences/active-tab', 'PUT', { activeTabId: newActiveTabId });
			if (!appData.loadedTasksForTabs.has(newActiveTabId)) {
				await loadTasksForTab(newActiveTabId);
			} else {
				updateCounterForTab(newActiveTabId);
				updateProgressbarForTab(newActiveTabId);
			}
			updateDeleteTabButtonVisibility();
		}
	});

	if (deleteTabGlobalBtn) deleteTabGlobalBtn.addEventListener("click", deleteTab);
	if (logoutButton) logoutButton.addEventListener("click", handleLogout);
}

function updateDeleteTabButtonVisibility() {
	if (deleteTabGlobalBtn) {
		const isMainActive = appData.activeTabId === "main";
		const onlyOneTabExists = appData.tabs.length <= 1;
		deleteTabGlobalBtn.style.display = (isMainActive || onlyOneTabExists) ? "none" : "inline-block";
	}
}

// --- Start the App ---
document.addEventListener('DOMContentLoaded', checkAuthAndInit);
