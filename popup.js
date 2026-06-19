// Глобальные переменные состояния
let githubToken = '';
let userRepos = [];
let selectedRepoOwner = '';
let selectedRepoName = '';
let selectedBranch = '';
let filesToUpload = [];

// DOM Элементы
const authSection = document.getElementById('auth-section');
const repoSection = document.getElementById('repo-section');
const uploadSection = document.getElementById('upload-section');
const progressSection = document.getElementById('progress-section');
const successSection = document.getElementById('success-section');

const tokenInput = document.getElementById('token-input');
const saveTokenBtn = document.getElementById('save-token-btn');
const authError = document.getElementById('auth-error');
const logoutBtn = document.getElementById('logout-btn');

const repoSelect = document.getElementById('repo-select');
const branchSelect = document.getElementById('branch-select');
const refreshReposBtn = document.getElementById('refresh-repos-btn');

const folderInput = document.getElementById('folder-input');
const folderPickerLabel = document.getElementById('folder-picker-label');
const fileCountInfo = document.getElementById('file-count-info');
const commitMessageInput = document.getElementById('commit-message');
const uploadBtn = document.getElementById('upload-btn');

const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');
const statusConsole = document.getElementById('status-console');

const successCommitInfo = document.getElementById('success-commit-info');
const viewRepoLink = document.getElementById('view-repo-link');
const backBtn = document.getElementById('back-btn');

// Инициализация расширения
document.addEventListener('DOMContentLoaded', async () => {
  // Загружаем сохраненные данные из chrome.storage.local
  chrome.storage.local.get(['token', 'repoOwner', 'repoName', 'branch'], async (result) => {
    if (result.token) {
      githubToken = result.token;
      tokenInput.value = githubToken;
      
      logToConsole('Проверка сохраненного токена...', 'loading');
      const isValid = await validateToken(githubToken);
      
      if (isValid) {
        showSection(repoSection);
        showSection(uploadSection);
        hideSection(authSection);
        
        if (result.repoOwner) selectedRepoOwner = result.repoOwner;
        if (result.repoName) selectedRepoName = result.repoName;
        if (result.branch) selectedBranch = result.branch;
        
        await loadRepositories(result.repoOwner && result.repoName ? `${result.repoOwner}/${result.repoName}` : null);
      } else {
        // Токен недействителен, очищаем
        chrome.storage.local.remove(['token', 'repoOwner', 'repoName', 'branch']);
        showSection(authSection);
        showError('Сохраненный токен недействителен или истек.');
      }
    } else {
      showSection(authSection);
    }
  });
});

// Кнопка сохранения токена
saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showError('Пожалуйста, введите токен.');
    return;
  }

  saveTokenBtn.disabled = true;
  authError.classList.add('hidden');
  
  const isValid = await validateToken(token);
  if (isValid) {
    githubToken = token;
    chrome.storage.local.set({ token: githubToken });
    
    showSection(repoSection);
    showSection(uploadSection);
    hideSection(authSection);
    
    await loadRepositories();
  } else {
    showError('Не удалось авторизоваться. Проверьте правильность токена и подключение к сети.');
  }
  saveTokenBtn.disabled = false;
});

// Выход (удаление токена)
logoutBtn.addEventListener('click', () => {
  chrome.storage.local.clear(() => {
    githubToken = '';
    userRepos = [];
    selectedRepoOwner = '';
    selectedRepoName = '';
    selectedBranch = '';
    filesToUpload = [];
    
    tokenInput.value = '';
    repoSelect.innerHTML = '<option value="" disabled selected>Загрузка репозиториев...</option>';
    branchSelect.innerHTML = '<option value="" disabled selected>Выберите репозиторий</option>';
    branchSelect.disabled = true;
    folderInput.value = '';
    folderPickerLabel.textContent = 'Выбрать папку';
    fileCountInfo.classList.add('hidden');
    uploadBtn.disabled = true;
    
    hideSection(repoSection);
    hideSection(uploadSection);
    hideSection(progressSection);
    hideSection(successSection);
    showSection(authSection);
  });
});

// Обновление списка репозиториев вручную
refreshReposBtn.addEventListener('click', async () => {
  if (!githubToken) return;
  
  refreshReposBtn.disabled = true;
  refreshReposBtn.textContent = 'Обновление...';
  
  const currentSelected = repoSelect.value;
  await loadRepositories(currentSelected);
  
  refreshReposBtn.textContent = 'Обновить';
  refreshReposBtn.disabled = false;
});

// Смена репозитория в выпадающем списке
repoSelect.addEventListener('change', async (e) => {
  const repoValue = e.target.value;
  if (!repoValue) return;

  const [owner, name] = repoValue.split('/');
  selectedRepoOwner = owner;
  selectedRepoName = name;
  
  chrome.storage.local.set({ repoOwner: owner, repoName: name });
  
  await loadBranches();
});

// Смена ветки
branchSelect.addEventListener('change', (e) => {
  selectedBranch = e.target.value;
  chrome.storage.local.set({ branch: selectedBranch });
  checkUploadButtonState();
});

// Выбор папки
folderInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) {
    filesToUpload = [];
    folderPickerLabel.textContent = 'Выбрать папку';
    fileCountInfo.classList.add('hidden');
    checkUploadButtonState();
    return;
  }

  // Фильтруем файлы:
  // Исключаем пути, содержащие .git/ или node_modules/
  // Исключаем пустые файлы
  filesToUpload = files.filter(file => {
    const path = file.webkitRelativePath.toLowerCase();
    const isGit = path.includes('/.git/') || path.startsWith('.git/');
    const isNodeModules = path.includes('/node_modules/') || path.startsWith('node_modules/');
    const isEmpty = file.size === 0;
    return !isGit && !isNodeModules && !isEmpty;
  });

  // Получаем имя корневой папки
  const rootFolderName = files[0].webkitRelativePath.split('/')[0];
  folderPickerLabel.textContent = rootFolderName;
  
  fileCountInfo.textContent = `Выбрано файлов для загрузки: ${filesToUpload.length} (отфильтровано: ${files.length - filesToUpload.length})`;
  fileCountInfo.classList.remove('hidden');
  
  checkUploadButtonState();
});

// Кнопка загрузки на GitHub
uploadBtn.addEventListener('click', async () => {
  if (filesToUpload.length === 0 || !selectedRepoOwner || !selectedRepoName || !selectedBranch) {
    return;
  }

  // Блокируем интерфейс и показываем консоль прогресса
  showSection(progressSection);
  hideSection(uploadSection);
  hideSection(repoSection);
  
  statusConsole.innerHTML = '';
  updateProgress(0);
  
  try {
    await performGitUpload();
  } catch (error) {
    logToConsole(`Критическая ошибка: ${error.message}`, 'error');
    updateProgress(0);
    // Добавляем кнопку возврата
    setTimeout(() => {
      showSection(repoSection);
      showSection(uploadSection);
      hideSection(progressSection);
    }, 4000);
  }
});

// Кнопка возврата с экрана успеха
backBtn.addEventListener('click', () => {
  hideSection(successSection);
  showSection(repoSection);
  showSection(uploadSection);
  
  // Сбрасываем выбор папки для безопасности
  folderInput.value = '';
  folderPickerLabel.textContent = 'Выбрать папку';
  fileCountInfo.classList.add('hidden');
  filesToUpload = [];
  checkUploadButtonState();
});


/* === Функции работы с GitHub API === */

// Проверка токена
async function validateToken(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    return response.ok;
  } catch (error) {
    console.error('Ошибка проверки токена:', error);
    return false;
  }
}

// Загрузка репозиториев
async function loadRepositories(savedRepo = null) {
  repoSelect.innerHTML = '<option value="" disabled selected>Загрузка списка репозиториев...</option>';
  repoSelect.disabled = true;
  
  try {
    let repos = [];
    let page = 1;
    let keepFetching = true;

    // Выкачиваем репозитории (поддержка пагинации до 200 штук)
    while (keepFetching && page <= 2) {
      const response = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`, {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) throw new Error(`Не удалось загрузить репозитории. Статус: ${response.status}`);
      
      const data = await response.json();
      if (data.length === 0) {
        keepFetching = false;
      } else {
        repos = repos.concat(data);
        if (data.length < 100) keepFetching = false;
        page++;
      }
    }
    
    userRepos = repos.filter(repo => repo.permissions && repo.permissions.push);
    
    repoSelect.innerHTML = '<option value="" disabled selected>Выберите репозиторий</option>';
    
    let savedRepoExistsInList = false;
    userRepos.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.full_name;
      option.textContent = repo.full_name;
      if (savedRepo && repo.full_name.toLowerCase() === savedRepo.toLowerCase()) {
        option.selected = true;
        selectedRepoOwner = repo.owner.login;
        selectedRepoName = repo.name;
        savedRepoExistsInList = true;
      }
      repoSelect.appendChild(option);
    });
    
    // Если сохраненный репозиторий не найден в списке (например, его нет на первой странице), добавляем его вручную
    if (savedRepo && !savedRepoExistsInList) {
      const option = document.createElement('option');
      option.value = savedRepo;
      option.textContent = `${savedRepo} (сохраненный)`;
      option.selected = true;
      repoSelect.appendChild(option);
      
      const [owner, name] = savedRepo.split('/');
      selectedRepoOwner = owner;
      selectedRepoName = name;
    }
    
    if (repoSelect.options.length <= 1) {
      repoSelect.innerHTML = '<option value="" disabled>У вас нет репозиториев с правами записи</option>';
      return;
    }
    
    repoSelect.disabled = false;
    
    if (selectedRepoOwner && selectedRepoName) {
      await loadBranches(selectedBranch);
    }
  } catch (error) {
    console.error(error);
    repoSelect.innerHTML = '<option value="" disabled>Ошибка загрузки репозиториев</option>';
  }
}

// Загрузка веток выбранного репозитория
async function loadBranches(savedBranch = null) {
  if (!selectedRepoOwner || !selectedRepoName) {
    branchSelect.innerHTML = '<option value="" disabled selected>Выберите репозиторий</option>';
    branchSelect.disabled = true;
    return;
  }
  
  branchSelect.innerHTML = '<option value="" disabled selected>Загрузка веток...</option>';
  branchSelect.disabled = true;
  
  try {
    const url = `https://api.github.com/repos/${selectedRepoOwner}/${selectedRepoName}/branches?per_page=100`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ошибка API (${response.status}): ${errText || response.statusText}`);
    }
    
    const branches = await response.json();
    branchSelect.innerHTML = '<option value="" disabled selected>Выберите ветку</option>';
    
    let branchFound = false;
    branches.forEach(branch => {
      const option = document.createElement('option');
      option.value = branch.name;
      option.textContent = branch.name;
      if (savedBranch && branch.name === savedBranch) {
        option.selected = true;
        branchFound = true;
      } else if (!savedBranch && branch.name === 'main') {
        option.selected = true;
        selectedBranch = 'main';
        branchFound = true;
      } else if (!savedBranch && !branchFound && branch.name === 'master') {
        option.selected = true;
        selectedBranch = 'master';
        branchFound = true;
      }
      branchSelect.appendChild(option);
    });
    
    if (!branchFound && branches.length > 0) {
      branchSelect.selectedIndex = 1;
      selectedBranch = branchSelect.value;
    }
    
    branchSelect.disabled = false;
    chrome.storage.local.set({ branch: selectedBranch });
    checkUploadButtonState();
  } catch (error) {
    console.error(error);
    branchSelect.innerHTML = `<option value="" disabled>Ошибка: ${error.message.substring(0, 30)}...</option>`;
    // Показываем ошибку в статусе, если есть консоль
    logToConsole(`Не удалось загрузить ветки для ${selectedRepoOwner}/${selectedRepoName}: ${error.message}`, 'error');
  }
}

// Основная функция загрузки по Git Data API
async function performGitUpload() {
  const repoUrl = `${selectedRepoOwner}/${selectedRepoName}`;
  const commitMessage = commitMessageInput.value.trim() || 'Upload files via GitPush';
  
  logToConsole(`Начало загрузки в ${repoUrl} [ветка: ${selectedBranch}]`, 'info');
  updateProgress(5);

  // Шаг 1: Получаем последний коммит ветки
  logToConsole('Шаг 1: Получение последнего коммита ветки...', 'loading');
  let refResponse = await fetch(`https://api.github.com/repos/${repoUrl}/git/refs/heads/${selectedBranch}`, {
    headers: { 'Authorization': `Bearer ${githubToken}` }
  });
  
  if (!refResponse.ok) {
    // Ветка может быть пустой/не существовать. Попробуем создать или выдать ошибку.
    throw new Error(`Ветка ${selectedBranch} не найдена или пуста. Проверьте права токена.`);
  }
  
  const refData = await refResponse.json();
  const parentCommitSha = refData.object.sha;
  logToConsole(`Последний коммит ветки: ${parentCommitSha.substring(0, 7)}`, 'success');
  updateProgress(15);

  // Шаг 2: Получаем SHA дерева последнего коммита
  logToConsole('Шаг 2: Получение структуры текущего дерева...', 'loading');
  const commitResponse = await fetch(`https://api.github.com/repos/${repoUrl}/git/commits/${parentCommitSha}`, {
    headers: { 'Authorization': `Bearer ${githubToken}` }
  });
  if (!commitResponse.ok) throw new Error('Не удалось получить информацию о коммите.');
  const commitData = await commitResponse.json();
  const baseTreeSha = commitData.tree.sha;
  logToConsole(`Базовое дерево коммита: ${baseTreeSha.substring(0, 7)}`, 'success');
  updateProgress(25);

  // Шаг 3: Создаем Blob'ы для каждого файла
  logToConsole(`Шаг 3: Создание Git Blobs для файлов (${filesToUpload.length})...`, 'loading');
  
  const treeItems = [];
  const startProgress = 25;
  const endProgress = 75;
  const progressStep = (endProgress - startProgress) / filesToUpload.length;

  for (let i = 0; i < filesToUpload.length; i++) {
    const file = filesToUpload[i];
    
    // Получаем относительный путь файла внутри выбранной папки
    // Пример: "my-folder/src/app.js" -> "src/app.js"
    const relativePath = cleanRelativePath(file.webkitRelativePath);
    
    logToConsole(`Кодирование и загрузка: ${relativePath}...`, 'loading');
    
    const base64Content = await fileToBase64(file);
    
    // Отправляем Blob на GitHub
    const blobResponse = await fetch(`https://api.github.com/repos/${repoUrl}/git/blobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: base64Content,
        encoding: 'base64'
      })
    });

    if (!blobResponse.ok) {
      const errText = await blobResponse.text();
      throw new Error(`Ошибка создания blob для ${relativePath}: ${errText}`);
    }

    const blobData = await blobResponse.json();
    logToConsole(`Создан blob для ${relativePath} (SHA: ${blobData.sha.substring(0, 7)})`, 'success');
    
    // Добавляем элемент для дерева коммита
    treeItems.push({
      path: relativePath,
      mode: '100644', // Обычный файл
      type: 'blob',
      sha: blobData.sha
    });

    updateProgress(Math.round(startProgress + (i + 1) * progressStep));
  }

  // Шаг 4: Создаем новое дерево
  logToConsole('Шаг 4: Создание дерева коммита на GitHub...', 'loading');
  const treeResponse = await fetch(`https://api.github.com/repos/${repoUrl}/git/trees`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems
    })
  });

  if (!treeResponse.ok) {
    const errText = await treeResponse.text();
    throw new Error(`Ошибка создания дерева Git: ${errText}`);
  }

  const treeData = await treeResponse.json();
  const newTreeSha = treeData.sha;
  logToConsole(`Создано дерево коммита: ${newTreeSha.substring(0, 7)}`, 'success');
  updateProgress(85);

  // Шаг 5: Создаем коммит
  logToConsole('Шаг 5: Создание коммита...', 'loading');
  const newCommitResponse = await fetch(`https://api.github.com/repos/${repoUrl}/git/commits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: commitMessage,
      tree: newTreeSha,
      parents: [parentCommitSha]
    })
  });

  if (!newCommitResponse.ok) {
    const errText = await newCommitResponse.text();
    throw new Error(`Ошибка коммита: ${errText}`);
  }

  const newCommitData = await newCommitResponse.json();
  const newCommitSha = newCommitData.sha;
  logToConsole(`Создан коммит: ${newCommitSha.substring(0, 7)}`, 'success');
  updateProgress(90);

  // Шаг 6: Обновляем ветку
  logToConsole('Шаг 6: Обновление ссылки ветки (push)...', 'loading');
  const refUpdateResponse = await fetch(`https://api.github.com/repos/${repoUrl}/git/refs/heads/${selectedBranch}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sha: newCommitSha,
      force: false
    })
  });

  if (!refUpdateResponse.ok) {
    const errText = await refUpdateResponse.text();
    throw new Error(`Ошибка push: ${errText}`);
  }

  logToConsole('Ссылка ветки успешно обновлена!', 'success');
  updateProgress(100);

  // Переходим на экран успеха
  setTimeout(() => {
    hideSection(progressSection);
    
    // Настраиваем ссылку на репозиторий
    viewRepoLink.href = `https://github.com/${repoUrl}/tree/${selectedBranch}`;
    successCommitInfo.textContent = `Коммит ${newCommitSha.substring(0, 7)} успешно создан в ветке ${selectedBranch}. Добавлено файлов: ${treeItems.length}.`;
    
    showSection(successSection);
  }, 1000);
}


/* === Вспомогательные функции === */

function showSection(section) {
  section.classList.remove('hidden');
  section.classList.add('active');
}

function hideSection(section) {
  section.classList.add('hidden');
  section.classList.remove('active');
}

function showError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

function checkUploadButtonState() {
  const isReady = githubToken && selectedRepoOwner && selectedRepoName && selectedBranch && filesToUpload.length > 0;
  uploadBtn.disabled = !isReady;
}

function updateProgress(percentage) {
  progressBarFill.style.width = `${percentage}%`;
  progressText.textContent = `${percentage}%`;
}

function logToConsole(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  
  // Добавляем префикс времени
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  line.textContent = `[${timeStr}] ${message}`;
  
  statusConsole.appendChild(line);
  statusConsole.scrollTop = statusConsole.scrollHeight;
}

function cleanRelativePath(path) {
  // webkitRelativePath возвращает "folder-name/subfolder/file.ext"
  // Нам нужно вырезать "folder-name/"
  const parts = path.split('/');
  if (parts.length > 1) {
    parts.shift(); // Удаляем первый элемент (имя папки)
    return parts.join('/');
  }
  return path;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // FileReader возвращает "data:application/octet-stream;base64,BASE64_DATA"
      // Получаем только BASE64_DATA
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}
