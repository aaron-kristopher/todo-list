const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateElement = document.getElementById("date-info");
const timeElement = document.getElementById("time-info");

const taskTabs = document.getElementById("task-tabs");
const tasksTabContent = document.getElementById("tasks-tab-content");
const submitTabBtn = document.getElementById("submit-tab");
const addTabForm = document.getElementById("add-tab-form");

const addTaskBtn = document.getElementById("submit-task");
const taskInput = document.getElementById("task");
const taskDescriptionInput = document.getElementById("description");
const taskForm = document.querySelector("#add-task form");

const importTasksBtn = document.getElementById("import-tasks-btn");
const taskFileInput = document.getElementById("task-file");

// Add this function to handle the file import
function importTasksFromFile() {
	const fileInput = document.getElementById("task-file");
	const markCompleted = document.getElementById("mark-completed").checked;

	if (!fileInput.files || fileInput.files.length === 0) {
		alert("Please select a file to import.");
		return;
	}

	const file = fileInput.files[0];
	const reader = new FileReader();

	reader.onload = function(e) {
		const contents = e.target.result;
		const lines = contents.split('\n').filter(line => line.trim() !== '');

		// Get active tab
		const activeTab = document.querySelector(".tab-pane.active");
		if (!activeTab) return;

		const tabId = activeTab.id.replace("-pane", "");
		const tasksSection = activeTab.querySelector(".tasks-section");

		let importCount = 0;

		// Process each line as a task
		lines.forEach(line => {
			// Split by pipe (|) to separate task name and description
			const parts = line.split('|').map(part => part.trim());
			const taskName = parts[0];
			const description = parts.length > 1 ? parts[1] : '';

			if (taskName) {
				// Create task element
				const taskElement = createTaskElement(tasksSection, taskName, description, markCompleted);

				// Make sure we have the array for this tab
				if (!appData.tasks[tabId]) {
					appData.tasks[tabId] = [];
				}

				appData.tasks[tabId].push({
					text: taskName,
					description: description,
					completed: markCompleted
				});

				importCount++;
			}
		});


		// Save to localStorage
		saveToLocalStorage();


		// Close the modal
		const modal = bootstrap.Modal.getInstance(document.getElementById('import-tasks-modal'));
		if (modal) {
			modal.hide();
		}

		// Reset the file input
		fileInput.value = '';
		document.getElementById("mark-completed").checked = false;

		// Show success message
		alert(`Successfully imported ${importCount} tasks.`);
	};

	reader.onerror = function() {
		alert('Error reading file');
	};

	reader.readAsText(file);
}

// Add these event listeners to your initialization
function addFileImportListeners() {
	// Add task import button event listener
	if (importTasksBtn) {
		importTasksBtn.addEventListener("click", importTasksFromFile);
	}

	// Add file input change listener to show filename
	if (taskFileInput) {
		taskFileInput.addEventListener('change', function() {
			const fileName = this.files[0]?.name;
			if (fileName) {
				this.nextElementSibling = fileName;
			}
		});
	}
}

// Data structure to store all tabs and tasks
let appData = {
	tabs: ["main"], // Default tab is always present
	activeTab: "main",
	tasks: {} // Will store tasks by tab ID: { tabId: [{ text, description, completed }] }
};

// Initialize localStorage if not exists
function initLocalStorage() {
	const savedData = localStorage.getItem('taskHiveData');
	if (savedData) {
		appData = JSON.parse(savedData);

		// Ensure main tab exists in data structure
		if (!appData.tasks["main"]) {
			appData.tasks["main"] = [];
		}

		// Restore tabs
		restoreTabs();

		// Restore tasks
		restoreTasks();

		// Set active tab
		if (appData.activeTab) {
			const tabToActivate = document.getElementById(appData.activeTab);
			if (tabToActivate) {
				// Use Bootstrap's tab API to activate the saved tab
				const tab = new bootstrap.Tab(tabToActivate);
				tab.show();
			}
		}
	} else {
		// If no saved data, initialize with an empty main tab
		appData.tasks["main"] = [];
	}
}

// Save all app data to localStorage
function saveToLocalStorage() {
	localStorage.setItem('taskHiveData', JSON.stringify(appData));
}

// Restore tabs from localStorage
function restoreTabs() {
	// Skip the first tab (main) as it's already in the DOM
	for (let i = 1; i < appData.tabs.length; i++) {
		const tabId = appData.tabs[i];
		const tabName = tabId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

		createTabElement(tabName, tabId, false); // Don't activate restored tabs by default
	}
}

// Restore tasks from localStorage
function restoreTasks() {
	// For each tab in our data
	Object.keys(appData.tasks).forEach(tabId => {
		const tasksSection = document.getElementById(`${tabId}-tasks-section`);
		if (!tasksSection) return;

		// Clear existing tasks if any (to prevent duplicates)
		const existingTasks = tasksSection.querySelectorAll(".form-check");
		existingTasks.forEach(task => task.remove());

		// Create each task in this tab
		appData.tasks[tabId].forEach(task => {
			createTaskElement(tasksSection, task.text, task.description, task.completed);
		});

		// Update counters for this tab
		updateCounterForTab(tabId);
	});
}

// Fix the ID references for the main tab in these functions
function updateCounterForTab(tabId) {
	// Special handling for main tab
	let tasksSection;
	if (tabId === "main") {
		tasksSection = document.getElementById("tasks-section"); // Main tab has a special ID
	} else {
		tasksSection = document.getElementById(`${tabId}-tasks-section`);
	}

	if (!tasksSection) return;

	const checkboxes = tasksSection.querySelectorAll("input[type=checkbox]");
	const count = checkboxes.length;

	// Update the counter display
	let counter;
	if (tabId === "main") {
		counter = document.getElementById("main-counter");
	} else {
		counter = document.getElementById(`${tabId}-counter`);
	}

	if (counter) {
		counter.textContent = `${count} ${count === 1 ? "task" : "tasks"}`;
	}

	// Update progress bar
	updateProgressbarForTab(tabId);
}

// Helper function to create a tab element
function createTabElement(tabName, tabId, activateTab = true) {
	// Create tab button
	const li = document.createElement("li");
	li.classList.add("nav-item");
	li.role = "presentation";

	const button = document.createElement("button");
	button.classList.add("nav-link", "me-2");
	button.id = tabId;
	button.setAttribute("data-bs-toggle", "tab");
	button.setAttribute("data-bs-target", `#${tabId}-pane`);
	button.setAttribute("type", "button");
	button.setAttribute("role", "tab");
	button.setAttribute("aria-controls", `${tabId}-pane`);
	button.setAttribute("aria-selected", "false");
	button.textContent = tabName;

	// Add event listener to track active tab
	button.addEventListener('shown.bs.tab', () => {
		appData.activeTab = tabId;
		saveToLocalStorage();
	});

	li.appendChild(button);
	taskTabs.insertBefore(li, taskTabs.lastElementChild);

	// Create tab content pane
	const tabContent = document.createElement("div");
	tabContent.classList.add("tab-pane", "fade");
	tabContent.id = `${tabId}-pane`;
	tabContent.setAttribute("role", "tabpanel");
	tabContent.setAttribute("tabindex", "0");

	tabContent.innerHTML = `
  <div class="row p-4 bg-content align-items-center">
    <div class="col-12 col-lg-5 p-0 px-lg-3 pb-5 text-center">
      <button class="btn btn-primary justify-item-center rounded-pill px-4 me-2" data-bs-toggle="modal"
	data-bs-target="#add-task">Add Task</button>
      <button class="btn btn-dark justify-item-center rounded-pill px-4" data-bs-toggle="modal"
	data-bs-target="#import-tasks-modal">Import Tasks</button>
    </div>

    <div class="offset-lg-1 col-lg-5 tasks-section" id="${tabId}-tasks-section">
      <h4 class="fw-bold">Hi, User</h4>
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
    </div>
  </div>
  `;

	tasksTabContent.appendChild(tabContent);

	// Activate the new tab if requested
	if (activateTab && tabId !== "main") {
		const newTab = new bootstrap.Tab(button);
		newTab.show();
	}
}

// Helper function to create a task element
function createTaskElement(tasksSection, taskText, taskDescription, isCompleted) {
	const formCheck = document.createElement("div");
	const taskCheckbox = document.createElement("input");
	const taskCheckLabel = document.createElement("label");
	const close = document.createElement("button");

	taskCheckbox.type = "checkbox";
	taskCheckbox.checked = isCompleted;
	taskCheckLabel.textContent = taskText;
	close.textContent = "remove";

	formCheck.classList.add("form-check", "pb-3", "position-relative");
	taskCheckbox.classList.add("form-check-input");
	taskCheckLabel.classList.add("form-check-label", "ps-4");
	close.classList.add("btn", "btn-primary", "btn-sm", "rounded-pill", "px-3", "position-absolute", "end-0", "top-0", "remove-task");

	close.setAttribute("onclick", "removeTask(event)");

	if (taskDescription) {
		taskCheckLabel.setAttribute("data-bs-toggle", "tooltip");
		taskCheckLabel.setAttribute("data-bs-placement", "top");
		taskCheckLabel.setAttribute("data-bs-title", taskDescription);
	}

	// Apply text decoration if task is completed
	if (isCompleted) {
		taskCheckLabel.style.textDecoration = "line-through";
	}

	// Ensure the change event is properly attached
	taskCheckbox.addEventListener("change", function() {
		toggleTask(this);
	});

	formCheck.appendChild(taskCheckbox);
	formCheck.appendChild(taskCheckLabel);
	formCheck.appendChild(close);
	tasksSection.appendChild(formCheck);

	// Initialize tooltip if description exists
	if (taskDescription) {
		new bootstrap.Tooltip(taskCheckLabel);
	}

	// Return the created element for potential further handling
	return formCheck;
}

// Function to delete a tab
function deleteTab() {
	// Only proceed if we have more than one tab and not trying to delete the main tab
	if (appData.tabs.length <= 1 || appData.activeTab === "main") {
		alert("Cannot delete the main tab!");
		return;
	}

	// Get the current active tab ID
	const tabIdToDelete = appData.activeTab;

	// Remove tab from UI
	const tabElement = document.getElementById(tabIdToDelete);
	const tabContent = document.getElementById(`${tabIdToDelete}-pane`);

	if (tabElement && tabContent) {
		// Remove from DOM
		tabElement.parentNode.remove();
		tabContent.remove();

		// Remove from data structure
		const tabIndex = appData.tabs.indexOf(tabIdToDelete);
		if (tabIndex !== -1) {
			appData.tabs.splice(tabIndex, 1);
		}

		// Remove tasks associated with this tab
		delete appData.tasks[tabIdToDelete];

		// Set main tab as active
		appData.activeTab = "main";
		const mainTab = document.getElementById("main");
		const tab = new bootstrap.Tab(mainTab);
		tab.show();

		// Save changes
		saveToLocalStorage();
	}
}

// Update counter for a specific tab
function updateCounter() {
	const activeTab = document.querySelector(".tab-pane.active");
	if (!activeTab) return; // Safety check

	const tabId = activeTab.id.replace("-pane", "");

	// Special handling for main tab
	if (tabId === "main") {
		updateCounterForTab("main");
	} else {
		updateCounterForTab(tabId);
	}
}

// Update progress bar for a specific tab
function updateProgressbarForTab(tabId) {
	// Special handling for main tab
	let tasksSection;
	if (tabId === "main") {
		tasksSection = document.getElementById("tasks-section"); // Main tab has a special ID
	} else {
		tasksSection = document.getElementById(`${tabId}-tasks-section`);
	}

	if (!tasksSection) return;

	const checkboxes = tasksSection.querySelectorAll("input[type=checkbox]");
	let completedCount = 0;

	checkboxes.forEach(checkbox => {
		if (checkbox.checked) completedCount++;
	});

	const totalProgress = checkboxes.length > 0 ? Math.round((completedCount / checkboxes.length) * 100) : 0;

	// Update progress indicators
	let progressPercent, progressBar;
	if (tabId === "main") {
		progressPercent = document.getElementById("main-progress-percent");
		progressBar = document.getElementById("main-progress-bar");
	} else {
		progressPercent = document.getElementById(`${tabId}-progress-percent`);
		progressBar = document.getElementById(`${tabId}-progress-bar`);
	}

	if (progressPercent) progressPercent.textContent = `${totalProgress}%`;
	if (progressBar) progressBar.style.width = `${totalProgress}%`;
}

// Time function - update clock
function time() {
	var hours = new Date().getHours();
	var min = new Date().getMinutes();

	var meridiem = hours >= 12 ? "PM" : "AM";
	hours = hours % 12 || 12; // Convert 0 to 12
	min = min < 10 ? `0${min}` : min;
	timeElement.textContent = `${hours}:${min} ${meridiem}`
}

// Date function - update date
function day() {
	var date = new Date().toLocaleDateString();
	var day = weekday[new Date().getDay()];

	dateElement.textContent = `${day}, ${date}`
}

// Function to handle tab submission
function handleTabSubmission() {
	const tabNameInput = document.getElementById("tab-name");
	const tabName = tabNameInput.value.trim();

	if (!tabName) return; // Prevent empty tab names

	const sanitizedTabId = tabName.replace(/\s+/g, "-").toLowerCase(); // Convert spaces to dashes

	// Add to our data structure
	appData.tabs.push(sanitizedTabId);
	appData.tasks[sanitizedTabId] = [];
	saveToLocalStorage();

	// Create tab elements with activate=true to auto-activate
	createTabElement(tabName, sanitizedTabId, true);

	// Reset input field
	tabNameInput.value = "";

	// Close the modal
	const modal = bootstrap.Modal.getInstance(document.getElementById('add-tab-modal'));
	if (modal) {
		modal.hide();
	}
}

// Function to handle task submission
function handleTaskSubmission() {
	var taskName = taskInput.value.trim();
	if (taskName === "") return;

	const description = taskDescriptionInput.value.trim();

	// Get the currently active tab pane
	const activeTab = document.querySelector(".tab-pane.active");
	if (!activeTab) return; // Safety check

	const tabId = activeTab.id.replace("-pane", "");

	// Find the tasks section inside the active tab
	const tasksSection = activeTab.querySelector(".tasks-section");
	if (!tasksSection) return; // Safety check

	// Create task elements
	createTaskElement(tasksSection, taskName, description, false);

	// Add to our data structure
	if (!appData.tasks[tabId]) {
		appData.tasks[tabId] = [];
	}

	appData.tasks[tabId].push({
		text: taskName,
		description: description,
		completed: false
	});

	// Save to localStorage
	saveToLocalStorage();

	// Clear input fields
	taskInput.value = "";
	taskDescriptionInput.value = "";

	// Update counters
	updateCounter();

	// Close the modal
	const modal = bootstrap.Modal.getInstance(document.getElementById('add-task'));
	if (modal) {
		modal.hide();
	}
}

// Add tab button event listener
submitTabBtn.addEventListener("click", function(event) {
	event.preventDefault(); // Prevent default button behavior
	handleTabSubmission();
});

// Add task button event listener
addTaskBtn.addEventListener("click", function(event) {
	event.preventDefault(); // Prevent default button behavior
	handleTaskSubmission();
});

// Prevent form submissions and handle Enter key
if (addTabForm) {
	addTabForm.addEventListener("submit", function(event) {
		event.preventDefault(); // Prevent the form from submitting
		handleTabSubmission();
	});
}

if (taskForm) {
	taskForm.addEventListener("submit", function(event) {
		event.preventDefault(); // Prevent the form from submitting
		handleTaskSubmission();
	});
}

// Add keydown event listeners to handle Enter key in input fields
document.getElementById("tab-name").addEventListener("keydown", function(event) {
	if (event.key === "Enter") {
		event.preventDefault();
		handleTabSubmission();
	}
});

taskInput.addEventListener("keydown", function(event) {
	if (event.key === "Enter") {
		event.preventDefault();
		handleTaskSubmission();
	}
});

taskDescriptionInput.addEventListener("keydown", function(event) {
	if (event.key === "Enter") {
		event.preventDefault();
		handleTaskSubmission();
	}
});

// Update counter for the active tab
function updateCounter() {
	const activeTab = document.querySelector(".tab-pane.active");
	if (!activeTab) return; // Safety check

	const tabId = activeTab.id.replace("-pane", "");
	updateCounterForTab(tabId);
}

// Update progress bar for the active tab
function updateProgressbar() {
	const activeTab = document.querySelector(".tab-pane.active");
	if (!activeTab) return; // Safety check

	const tabId = activeTab.id.replace("-pane", "");

	// Special handling for main tab
	if (tabId === "main") {
		updateProgressbarForTab("main");
	} else {
		updateProgressbarForTab(tabId);
	}

	// Save task completion status to localStorage
	saveTasksForActiveTab();
}

// Save tasks for the active tab
function saveTasksForActiveTab() {
	const activeTab = document.querySelector(".tab-pane.active");
	if (!activeTab) return;

	const tabId = activeTab.id.replace("-pane", "");

	// Special handling for main tab
	let tasksSection;
	if (tabId === "main") {
		tasksSection = document.getElementById("tasks-section");
	} else {
		tasksSection = activeTab.querySelector(".tasks-section");
	}

	if (!tasksSection) return;

	const taskElements = tasksSection.querySelectorAll(".form-check");

	// Ensure array exists
	if (!appData.tasks[tabId]) {
		appData.tasks[tabId] = [];
	} else {
		// Clear existing tasks for this tab
		appData.tasks[tabId] = [];
	}

	// Rebuild tasks array from DOM
	taskElements.forEach(taskElement => {
		const checkbox = taskElement.querySelector("input[type=checkbox]");
		const label = taskElement.querySelector(".form-check-label");
		if (checkbox && label) {
			appData.tasks[tabId].push({
				text: label.textContent,
				description: label.getAttribute("data-bs-title") || "",
				completed: checkbox.checked
			});
		}
	});

	// Save to localStorage
	saveToLocalStorage();
}

// Toggle task completion
function toggleTask(checkbox) {
	// Update visual appearance
	if (checkbox.checked) {
		checkbox.nextSibling.style.textDecoration = "line-through";
	} else {
		checkbox.nextSibling.style.textDecoration = "none";
	}

	// Get the task text
	const taskLabel = checkbox.nextSibling;
	const taskText = taskLabel.textContent;

	// Get active tab
	const activeTab = document.querySelector(".tab-pane.active");
	if (!activeTab) return; // Safety check

	const tabId = activeTab.id.replace("-pane", "");

	// Ensure task array exists for this tab
	if (!appData.tasks[tabId]) {
		appData.tasks[tabId] = [];
		console.log(`Created tasks array for tab: ${tabId}`);
	}

	// Find task in the array
	const taskIndex = appData.tasks[tabId].findIndex(task => task.text === taskText);

	if (taskIndex !== -1) {
		// Update existing task
		appData.tasks[tabId][taskIndex].completed = checkbox.checked;
		console.log(`Updated task "${taskText}" in ${tabId} to ${checkbox.checked}`);
	} else {
		// If task not found, add it (for robustness)
		const description = taskLabel.getAttribute("data-bs-title") || "";
		appData.tasks[tabId].push({
			text: taskText,
			description: description,
			completed: checkbox.checked
		});
		console.log(`Added missing task "${taskText}" to ${tabId}`);
	}

	// Save immediately to ensure state is preserved
	saveToLocalStorage();

	// Update progress bar
	updateProgressbar();
}

// Remove a task
function removeTask(event) {
	const taskForm = event.target.parentNode;
	const taskFormContainer = taskForm.parentNode;
	const taskLabel = taskForm.querySelector(".form-check-label");

	// Remove from DOM
	taskFormContainer.removeChild(taskForm);

	// Get active tab
	const activeTab = document.querySelector(".tab-pane.active");
	const tabId = activeTab.id.replace("-pane", "");

	// Remove from data structure
	const taskIndex = appData.tasks[tabId].findIndex(task =>
		task.text === taskLabel.textContent
	);

	if (taskIndex !== -1) {
		appData.tasks[tabId].splice(taskIndex, 1);
		saveToLocalStorage();
	}

	// Update counters
	updateCounter();
	updateProgressbar();
}

// Listen for tab changes to update UI accordingly
document.addEventListener('shown.bs.tab', function(event) {
	const activeTabId = event.target.id;
	appData.activeTab = activeTabId;
	saveToLocalStorage();
});

// Initialize app
function initApp() {
	// Set up date and time
	day();
	time();
	setInterval(time, 60000);

	// Set up event listener for main tab
	const mainTab = document.getElementById("main");
	mainTab.addEventListener('shown.bs.tab', () => {
		appData.activeTab = "main";
		saveToLocalStorage();
	});

	// Make sure main tab data is properly initialized
	if (!appData.tasks["main"]) {
		appData.tasks["main"] = [];
	}

	// Add delete tab button
	const topDiv = document.getElementById("top");
	if (topDiv) {
		const deleteButton = document.createElement("button");
		const deleteIcon = document.createElement("span")
		deleteButton.classList.add("btn", "btn-primary", "btn-sm", "rounded-pill", "px-3", "ms-auto");
		deleteIcon.classList.add("material-symbols-outlined", "d-flex", "align-items-center")
		deleteButton.setAttribute("data-bs-toggle", "tooltip");
		deleteButton.setAttribute("data-bs-placement", "top");
		deleteButton.setAttribute("data-bs-title", "Delete Tab");
		deleteIcon.textContent = "delete"
		deleteButton.onclick = deleteTab;
		deleteButton.appendChild(deleteIcon);


		new bootstrap.Tooltip(deleteButton);

		// Create a wrapper div for positioning
		const buttonWrapper = document.createElement("div");
		buttonWrapper.classList.add("col-auto", "d-flex", "align-items-center");
		buttonWrapper.appendChild(deleteButton);

		topDiv.appendChild(buttonWrapper);
	}

	// Initialize file import listeners
	addFileImportListeners();

	// Initialize data from localStorage
	initLocalStorage();
}

// Start the app
document.addEventListener('DOMContentLoaded', initApp);
