const calendar = Calendar(document.getElementById('root'), {type: 'inline', value: new Date()});

const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateElement = document.getElementById("date-info");
const timeElement = document.getElementById("time-info");

const taskTabs = document.getElementById("task-tabs");
const tasksTabContent = document.getElementById("tasks-tab-content");
const submitTabBtn = document.getElementById("submit-tab");

const addTaskBtn = document.getElementById("submit-task");
const taskInput = document.getElementById("task");
const tasksSection = document.getElementById("tasks-section")

const counter = document.getElementById("counter");
const progressbar = document.getElementById("progress-bar");
const progressPercent = document.getElementById("progress-percent");

function time() {
  var hours = new Date().getHours();
  var min = new Date().getMinutes();

  var meridiem = hours >= 12 ? "PM" : "AM";
  hours %= 12;
  min = min < 10 ? `0${min}` : min;
  timeElement.textContent = `${hours}:${min} ${meridiem}`
}

function day() {
  var date = new Date().toLocaleDateString();
  var day = weekday[new Date().getDay()];

  dateElement.textContent = `${day}, ${date}`
}

submitTabBtn.addEventListener("click", function () {
  const tabNameInput = document.getElementById("tab-name");
  const tabName = tabNameInput.value.trim();

  if (!tabName) return; // Prevent empty tab names

  const sanitizedTabName = tabName.replace(/\s+/g, "-").toLowerCase(); // Convert spaces to dashes

  // Create tab elements
  const li = document.createElement("li");
  li.classList.add("nav-item");
  li.role = "presentation";

  const button = document.createElement("button");
  button.classList.add("nav-link", "me-2");
  button.id = sanitizedTabName;
  button.setAttribute("data-bs-toggle", "tab");
  button.setAttribute("data-bs-target", `#${sanitizedTabName}-pane`);
  button.setAttribute("type", "button");
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", `${sanitizedTabName}-pane`);
  button.setAttribute("aria-selected", "false");
  button.textContent = tabName;

  li.appendChild(button);
  taskTabs.insertBefore(li, taskTabs.lastElementChild);

  const tabContent = document.createElement("div");
  tabContent.classList.add("tab-pane", "fade");
  tabContent.id = `${sanitizedTabName}-pane`;
  tabContent.setAttribute("role", "tabpanel");
  tabContent.setAttribute("tabindex", "0");

  tabContent.innerHTML = `
  <div class="row p-4">
	<div class="col-12 col-lg-5 p-0 px-lg-3 pb-5 text-center">
	  <div class="mb-4" id="${sanitizedTabName}-root" style="background-color: white;"></div>
	  <button class="btn btn-dark rounded-pill px-4" data-bs-toggle="modal" data-bs-target="#add-task">
		Add Task
	  </button>
	</div>

	<div class="offset-1 col-md-5" id="${sanitizedTabName}-tasks-section">
	  <h4 class="fw-bold">Hi, User</h4>
	  <h3>You have <span id="${sanitizedTabName}-counter">0 tasks</span></h3>
	  <div class="progress-wrapper pt-4">
		<div class="d-flex justify-content-between">
		  <p>Your progress</p>
		  <p id="${sanitizedTabName}-progress-percent">0%</p>
		</div>
		<div class="progress mb-4">
		  <div id="${sanitizedTabName}-progress-bar" class="progress-bar progress-bar-striped progress-bar-animated bg-warning"
			role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%">
		  </div>
		</div>
	  </div>
	</div>
  </div>
`;

  tasksTabContent.appendChild(tabContent);

  // Reset input field (Bootstrap handles modal closing)
  tabNameInput.value = "";
});
function updateCounter() {
  const activeTab = document.querySelector(".tab-pane.active");  
  if (!activeTab) return; // Safety check

  const checkboxes = activeTab.querySelectorAll("input[type=checkbox]");
  var count = checkboxes.length;

  // Update the counter inside the active tab
  const counter = activeTab.querySelector("[id$='-counter']");
  if (counter) {
    counter.textContent = `${count} ${count === 1 ? "task" : "tasks"}`;
  }
}

function updateProgressbar() {
  const activeTab = document.querySelector(".tab-pane.active");
  if (!activeTab) return; // Safety check

  const checkboxes = activeTab.querySelectorAll("input[type=checkbox]");
  let progressCount = 0;
  let totalProgress = 0;

  checkboxes.forEach(checkbox => {
    if (checkbox.checked) progressCount++;
  });

  totalProgress = checkboxes.length > 0 ? Math.round((progressCount / checkboxes.length) * 100) : 0;

  // Update progress bar and percentage inside the active tab
  const progressPercent = activeTab.querySelector("[id$='-progress-percent']");
  const progressbar = activeTab.querySelector("[id$='-progress-bar']");

  if (progressPercent) progressPercent.textContent = `${totalProgress}%`;
  if (progressbar) progressbar.style.width = `${totalProgress}%`;
}

function toggleTask(checkbox) {

  updateProgressbar();

  if (checkbox.checked) {
	checkbox.nextSibling.style.textDecoration = "line-through";
  } else {
	checkbox.nextSibling.style.textDecoration = "none";
  }
}

addTaskBtn.addEventListener("click", (event) => {
  var taskName = taskInput.value.trim();
  if (taskName === "") return;

  // Get the currently active tab pane
  const activeTab = document.querySelector(".tab-pane.active");
  console.log(activeTab)
  
  if (!activeTab) return; // Safety check

  // Find the tasks section inside the active tab
  const tasksSection = activeTab.querySelector(".col-md-5");

  // Create task elements
  const formCheck = document.createElement("div");
  const taskCheckbox = document.createElement("input");
  const taskCheckLabel = document.createElement("label");

  taskCheckbox.type = "checkbox";
  taskCheckLabel.textContent = taskName;

  formCheck.classList.add("form-check");
  taskCheckbox.classList.add("form-check-input");
  taskCheckLabel.classList.add("form-check-label", "ps-4");

  taskCheckbox.addEventListener("change", () => toggleTask(taskCheckbox));

  formCheck.appendChild(taskCheckbox);
  formCheck.appendChild(taskCheckLabel);
  tasksSection.appendChild(formCheck);

  // Clear input field
  taskInput.value = "";

  updateCounter();
});


day();
time();
setInterval(time, 60000);

