// 宝贝成长册 - 主要逻辑

const DB_NAME = 'GrowthAlbumDB';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const GIST_FILENAME = 'growth-album-data.json';

let db;
let currentDate = new Date();
let currentMonth = new Date();
let selectedDate = null;
let editingRecord = null;
let pendingPhotos = [];
let pendingVideos = [];

// GitHub 同步配置
let githubConfig = {
    token: localStorage.getItem('github_token') || '',
    gistId: localStorage.getItem('github_gist_id') || '',
    syncEnabled: localStorage.getItem('github_sync_enabled') === 'true'
};

// DOM元素
const elements = {
    prevMonth: document.getElementById('prev-month'),
    nextMonth: document.getElementById('next-month'),
    currentMonth: document.getElementById('current-month'),
    calendarDays: document.getElementById('calendar-days'),
    timelineContainer: document.getElementById('timeline-container'),
    recordModal: document.getElementById('record-modal'),
    detailModal: document.getElementById('detail-modal'),
    pdfModal: document.getElementById('pdf-modal'),
    recordForm: document.getElementById('record-form'),
    photoInput: document.getElementById('photo-input'),
    videoInput: document.getElementById('video-input'),
    photoPreview: document.getElementById('photo-preview'),
    videoPreview: document.getElementById('video-preview'),
    photoUpload: document.getElementById('photo-upload'),
    videoUpload: document.getElementById('video-upload'),
    exportBtn: document.getElementById('export-btn'),
    clearBtn: document.getElementById('clear-btn')
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initCalendar();
    initEventListeners();
    await initGithubSync();
    loadRecords();
    updateSyncStatus();
});

// 初始化IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: false });
            }
        };
    });
}

// 初始化日历
function initCalendar() {
    renderCalendar();
}

// 渲染日历
function renderCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    elements.currentMonth.textContent = `${year}年${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    let html = '';

    // 填充空白
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // 填充日期
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month, day);
        const isToday = dateObj.toDateString() === today.toDateString();
        const isFuture = dateObj > today;

        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isFuture) classes += ' future';

        html += `<div class="${classes}" data-date="${dateStr}">${day}</div>`;
    }

    elements.calendarDays.innerHTML = html;

    // 标记有记录的日期
    markRecordDates();
}

// 标记有记录的日期
async function markRecordDates() {
    const records = await getAllRecords();
    const recordDates = new Set(records.map(r => r.date));

    document.querySelectorAll('.calendar-day[data-date]').forEach(el => {
        if (recordDates.has(el.dataset.date)) {
            el.classList.add('has-record');
        }
    });
}

// 初始化事件监听
function initEventListeners() {
    // 标签切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));

            btn.classList.add('active');

            if (btn.dataset.tab) {
                document.getElementById('calendar-view').classList.add('active');
            } else {
                document.getElementById('timeline-view').classList.add('active');
                loadRecords();
            }
        });
    });

    // 月份导航
    elements.prevMonth.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        renderCalendar();
    });

    elements.nextMonth.addEventListener('click', () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        renderCalendar();
    });

    // 日历日期点击
    elements.calendarDays.addEventListener('click', (e) => {
        const dayEl = e.target.closest('.calendar-day[data-date]');
        if (dayEl && !dayEl.classList.contains('future')) {
            openRecordModal(dayEl.dataset.date);
        }
    });

    // 记录弹窗
    document.getElementById('modal-close').addEventListener('click', closeRecordModal);
    document.getElementById('cancel-btn').addEventListener('click', closeRecordModal);
    elements.recordForm.addEventListener('submit', handleRecordSubmit);

    // 文件上传
    elements.photoUpload.addEventListener('click', () => elements.photoInput.click());
    elements.videoUpload.addEventListener('click', () => elements.videoInput.click());

    elements.photoInput.addEventListener('change', handlePhotoUpload);
    elements.videoInput.addEventListener('change', handleVideoUpload);

    // 详情弹窗
    document.getElementById('detail-close').addEventListener('click', closeDetailModal);
    document.getElementById('edit-record-btn').addEventListener('click', handleEditRecord);
    document.getElementById('delete-record-btn').addEventListener('click', handleDeleteRecord);

    // PDF导出
    elements.exportBtn.addEventListener('click', exportToPDF);
    document.getElementById('pdf-close').addEventListener('click', closePdfModal);
    document.getElementById('pdf-cancel-btn').addEventListener('click', closePdfModal);
    document.getElementById('pdf-download-btn').addEventListener('click', downloadPDF);

    // 云同步设置
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
    document.getElementById('settings-cancel-btn').addEventListener('click', closeSettingsModal);
    document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
    document.getElementById('sync-enabled').addEventListener('change', function() {
        document.getElementById('gist-id-group').style.display = this.checked ? 'block' : 'none';
    });

    // 清空数据
    elements.clearBtn.addEventListener('click', clearAllData);

    // 弹窗关闭
    [elements.recordModal, elements.detailModal, elements.pdfModal, document.getElementById('settings-modal')].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

// 打开记录弹窗
function openRecordModal(date, record = null) {
    editingRecord = record;
    selectedDate = date;

    document.getElementById('modal-title').textContent = record ? '编辑记录' : '添加记录';
    document.getElementById('record-id').value = record?.id || '';
    document.getElementById('record-date').value = date;
    document.getElementById('record-title').value = record?.title || '';
    document.getElementById('record-content').value = record?.content || '';

    // 清除待上传文件
    pendingPhotos = [];
    pendingVideos = [];
    renderFilePreviews();

    // 如果是编辑模式，显示已有文件
    if (record) {
        renderExistingFiles(record);
    }

    elements.recordModal.classList.add('active');
}

// 关闭记录弹窗
function closeRecordModal() {
    elements.recordModal.classList.remove('active');
    editingRecord = null;
    pendingPhotos = [];
    pendingVideos = [];
    elements.recordForm.reset();
}

// 处理照片上传
function handlePhotoUpload(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            pendingPhotos.push(file);
        }
    });
    renderFilePreviews();
    e.target.value = '';
}

// 处理视频上传
function handleVideoUpload(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (file.type.startsWith('video/')) {
            pendingVideos.push(file);
        }
    });
    renderFilePreviews();
    e.target.value = '';
}

// 渲染文件预览
function renderFilePreviews() {
    // 照片预览
    elements.photoPreview.innerHTML = pendingPhotos.map((file, index) => {
        const url = URL.createObjectURL(file);
        return `
            <div class="preview-item">
                <img src="${url}" alt="预览">
                <button type="button" class="remove-btn" onclick="removePhoto(${index})">&times;</button>
            </div>
        `;
    }).join('');

    // 视频预览
    elements.videoPreview.innerHTML = pendingVideos.map((file, index) => {
        const url = URL.createObjectURL(file);
        return `
            <div class="preview-item">
                <video src="${url}"></video>
                <button type="button" class="remove-btn" onclick="removeVideo(${index})">&times;</button>
            </div>
        `;
    }).join('');
}

// 渲染已有文件（编辑模式）
function renderExistingFiles(record) {
    // 照片
    if (record.photos && record.photos.length > 0) {
        elements.photoPreview.innerHTML = record.photos.map((photo, index) => `
            <div class="preview-item">
                <img src="${photo}" alt="照片">
                <button type="button" class="remove-btn" onclick="removeExistingPhoto(${index})">&times;</button>
            </div>
        `).join('');
    }

    // 视频
    if (record.videos && record.videos.length > 0) {
        elements.videoPreview.innerHTML = record.videos.map((video, index) => `
            <div class="preview-item">
                <video src="${video}"></video>
                <button type="button" class="remove-btn" onclick="removeExistingVideo(${index})">&times;</button>
            </div>
        `).join('');
    }
}

// 删除待上传照片
window.removePhoto = function(index) {
    pendingPhotos.splice(index, 1);
    renderFilePreviews();
};

// 删除待上传视频
window.removeVideo = function(index) {
    pendingVideos.splice(index, 1);
    renderFilePreviews();
};

// 处理记录提交
async function handleRecordSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('record-id').value || generateId();
    const date = document.getElementById('record-date').value;
    const title = document.getElementById('record-title').value;
    const content = document.getElementById('record-content').value;

    // 获取已有记录的文件（如果编辑模式）
    let photos = [];
    let videos = [];

    if (editingRecord) {
        photos = editingRecord.photos || [];
        videos = editingRecord.videos || [];
    }

    // 处理新上传的文件
    for (const file of pendingPhotos) {
        const base64 = await fileToBase64(file);
        photos.push(base64);
    }

    for (const file of pendingVideos) {
        const base64 = await fileToBase64(file);
        videos.push(base64);
    }

    const record = {
        id,
        date,
        title,
        content,
        photos,
        videos,
        createdAt: editingRecord?.createdAt || Date.now(),
        updatedAt: Date.now()
    };

    await saveRecord(record);
    closeRecordModal();
    renderCalendar();
    loadRecords();

    alert('记录保存成功！');
}

// 文件转Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 生成ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 保存记录
function saveRecord(record) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);
        request.onsuccess = async () => {
            await syncAllData();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// 获取所有记录
function getAllRecords() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 删除记录
function deleteRecord(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = async () => {
            await syncAllData();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// 清空所有数据
async function clearAllData() {
    if (confirm('确定要清空所有数据吗？此操作不可恢复！')) {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        location.reload();
    }
}

// 加载记录并渲染时间线
async function loadRecords() {
    const records = await getAllRecords();

    if (records.length === 0) {
        elements.timelineContainer.innerHTML = `
            <div class="empty-state">
                <p class="empty-icon">📷</p>
                <p>还没有记录哦</p>
                <p class="empty-hint">点击日历上的日期开始记录吧</p>
            </div>
        `;
        return;
    }

    // 按日期排序（最新的在前）
    records.sort((a, b) => new Date(b.date) - new Date(a.date));

    const html = records.map(record => {
        const date = new Date(record.date);
        const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

        let mediaHtml = '';

        if (record.photos && record.photos.length > 0) {
            mediaHtml += record.photos.slice(0, 3).map(photo =>
                `<img src="${photo}" alt="照片">`
            ).join('');
        }

        if (record.videos && record.videos.length > 0) {
            mediaHtml += record.videos.slice(0, 2).map(video =>
                `<video src="${video}" controls></video>`
            ).join('');
        }

        return `
            <div class="timeline-item" data-id="${record.id}">
                <div class="timeline-date">${dateStr}</div>
                <div class="timeline-title">${escapeHtml(record.title)}</div>
                <div class="timeline-content">${escapeHtml(record.content)}</div>
                ${mediaHtml ? `<div class="timeline-media">${mediaHtml}</div>` : ''}
            </div>
        `;
    }).join('');

    elements.timelineContainer.innerHTML = html;

    // 添加点击事件
    document.querySelectorAll('.timeline-item').forEach(item => {
        item.addEventListener('click', () => {
            const record = records.find(r => r.id === item.dataset.id);
            openDetailModal(record);
        });
    });
}

// 打开详情弹窗
function openDetailModal(record) {
    const date = new Date(record.date);
    const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

    document.getElementById('detail-title').textContent = record.title;
    document.getElementById('detail-content').innerHTML = `
        <p style="color: var(--primary-dark); margin-bottom: 15px;">${dateStr}</p>
        <p style="line-height: 1.8; margin-bottom: 20px;">${escapeHtml(record.content) || '暂无文字记录'}</p>
        ${renderDetailMedia(record)}
    `;

    document.getElementById('edit-record-btn').onclick = () => {
        closeDetailModal();
        openRecordModal(record.date, record);
    };

    document.getElementById('delete-record-btn').onclick = async () => {
        if (confirm('确定要删除这条记录吗？')) {
            await deleteRecord(record.id);
            closeDetailModal();
            renderCalendar();
            loadRecords();
            alert('记录已删除');
        }
    };

    elements.detailModal.classList.add('active');
}

// 渲染详情页媒体
function renderDetailMedia(record) {
    let html = '<div class="detail-media">';

    if (record.photos && record.photos.length > 0) {
        record.photos.forEach(photo => {
            html += `<img src="${photo}" alt="照片" onclick="previewImage('${photo}')">`;
        });
    }

    if (record.videos && record.videos.length > 0) {
        record.videos.forEach(video => {
            html += `<video src="${video}" controls></video>`;
        });
    }

    html += '</div>';
    return html;
}

// 关闭详情弹窗
function closeDetailModal() {
    elements.detailModal.classList.remove('active');
}

// 编辑记录
function handleEditRecord() {
    // 已在openDetailModal中处理
}

// 删除记录
function handleDeleteRecord() {
    // 已在openDetailModal中处理
}

// 导出PDF
async function exportToPDF() {
    const records = await getAllRecords();

    if (records.length === 0) {
        alert('还没有记录可导出，请先添加一些记录！');
        return;
    }

    // 按日期排序
    records.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 生成PDF预览
    const pdfContent = document.getElementById('pdf-preview');

    let html = `
        <div style="text-align: center; padding: 40px 20px; background: linear-gradient(135deg, #FFB6C1 0%, #FFD1DC 100%); border-radius: 20px; margin-bottom: 30px;">
            <h1 style="color: white; font-size: 2.5rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.1); margin-bottom: 10px;">🌸 宝贝成长册 🌸</h1>
            <p style="color: white; font-size: 1.2rem;">记录每一天的美好瞬间</p>
        </div>
    `;

    records.forEach(record => {
        const date = new Date(record.date);
        const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

        html += `
            <div style="background: white; border-radius: 20px; padding: 25px; margin-bottom: 25px; box-shadow: 0 4px 20px rgba(255, 182, 193, 0.3);">
                <div style="color: #FF8FA3; font-weight: 500; margin-bottom: 10px;">${dateStr}</div>
                <h3 style="font-size: 1.3rem; color: #5D4E60; margin-bottom: 12px;">${escapeHtml(record.title)}</h3>
                <p style="line-height: 1.8; color: #8B7B8C; margin-bottom: 15px;">${escapeHtml(record.content) || '暂无文字记录'}</p>
                ${renderPdfMedia(record)}
            </div>
        `;
    });

    pdfContent.innerHTML = html;
    elements.pdfModal.classList.add('active');
}

// 渲染PDF媒体
function renderPdfMedia(record) {
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px;">';

    if (record.photos && record.photos.length > 0) {
        record.photos.forEach(photo => {
            html += `<img src="${photo}" style="max-width: 180px; max-height: 120px; border-radius: 12px; object-fit: cover;">`;
        });
    }

    if (record.videos && record.videos.length > 0) {
        record.videos.forEach(video => {
            html += `<video src="${video}" controls style="max-width: 180px; max-height: 120px; border-radius: 12px;"></video>`;
        });
    }

    html += '</div>';
    return html;
}

// 关闭PDF预览
function closePdfModal() {
    elements.pdfModal.classList.remove('active');
}

// 下载PDF
function downloadPDF() {
    const element = document.getElementById('pdf-preview');

    const opt = {
        margin: 10,
        filename: '宝贝成长册.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        closePdfModal();
        alert('PDF下载成功！');
    });
}

// HTML转义
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 图片预览
window.previewImage = function(src) {
    const win = window.open('');
    win.document.write(`<img src="${src}" style="max-width: 100%;">`);
};

// ========== GitHub Gist 同步功能 ==========

// 保存到GitHub Gist
async function syncToGist() {
    if (!githubConfig.syncEnabled || !githubConfig.token) {
        return false;
    }

    try {
        const records = await getAllRecords();
        const data = JSON.stringify(records, null, 2);

        if (githubConfig.gistId) {
            // 更新已有Gist
            await updateGist(githubConfig.gistId, data);
        } else {
            // 创建新Gist
            const gistId = await createGist(data);
            githubConfig.gistId = gistId;
            localStorage.setItem('github_gist_id', gistId);
        }
        return true;
    } catch (error) {
        console.error('同步到GitHub失败:', error);
        return false;
    }
}

// 从GitHub Gist加载数据
async function loadFromGist() {
    if (!githubConfig.syncEnabled || !githubConfig.token || !githubConfig.gistId) {
        return null;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${githubConfig.gistId}`, {
            headers: {
                'Authorization': `token ${githubConfig.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) throw new Error('Failed to fetch gist');

        const gist = await response.json();
        const content = gist.files[GIST_FILENAME];
        if (content) {
            return JSON.parse(content.content);
        }
        return null;
    } catch (error) {
        console.error('从GitHub加载失败:', error);
        return null;
    }
}

// 创建新Gist
async function createGist(content) {
    const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
            'Authorization': `token ${githubConfig.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
            description: '🌸 宝贝成长册数据备份',
            public: false,
            files: {
                [GIST_FILENAME]: { content }
            }
        })
    });

    if (!response.ok) throw new Error('Failed to create gist');
    const gist = await response.json();
    return gist.id;
}

// 更新Gist
async function updateGist(gistId, content) {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${githubConfig.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
            files: {
                [GIST_FILENAME]: { content }
            }
        })
    });

    if (!response.ok) throw new Error('Failed to update gist');
}

// 同步所有数据
async function syncAllData() {
    const saved = await syncToGist();
    if (saved) {
        console.log('数据已同步到GitHub');
    }
}

// 初始化GitHub同步
async function initGithubSync() {
    if (githubConfig.syncEnabled && githubConfig.token && githubConfig.gistId) {
        // 尝试从Gist加载数据
        const remoteData = await loadFromGist();
        if (remoteData && remoteData.length > 0) {
            // 合并数据（以远程数据为准，或本地优先）
            const localData = await getAllRecords();
            if (localData.length === 0) {
                // 本地无数据，使用远程数据
                for (const record of remoteData) {
                    await saveRecord(record);
                }
                renderCalendar();
                loadRecords();
            }
        }
    }
}

// 更新同步状态显示
function updateSyncStatus() {
    const statusEl = document.getElementById('sync-status');
    if (!statusEl) return;

    if (githubConfig.syncEnabled && githubConfig.token) {
        statusEl.innerHTML = '☁️ 已开启云同步';
        statusEl.classList.add('synced');
    } else {
        statusEl.innerHTML = '💾 本地存储';
        statusEl.classList.remove('synced');
    }
}

// 打开设置弹窗
function openSettingsModal() {
    document.getElementById('github-token').value = githubConfig.token || '';
    document.getElementById('gist-id').value = githubConfig.gistId || '';
    document.getElementById('sync-enabled').checked = githubConfig.syncEnabled;
    document.getElementById('gist-id-group').style.display = githubConfig.syncEnabled ? 'block' : 'none';
    document.getElementById('settings-modal').classList.add('active');
}

// 关闭设置弹窗
function closeSettingsModal() {
    document.getElementById('settings-modal').classList.remove('active');
}

// 保存设置
async function saveSettings() {
    const token = document.getElementById('github-token').value.trim();
    const gistId = document.getElementById('gist-id').value.trim();
    const syncEnabled = document.getElementById('sync-enabled').checked;

    if (syncEnabled && !token) {
        alert('请输入GitHub Token');
        return;
    }

    // 保存到localStorage
    localStorage.setItem('github_token', token);
    localStorage.setItem('github_gist_id', gistId);
    localStorage.setItem('github_sync_enabled', syncEnabled.toString());

    // 更新配置
    githubConfig.token = token;
    githubConfig.gistId = gistId;
    githubConfig.syncEnabled = syncEnabled;

    // 如果开启同步，尝试创建Gist
    if (syncEnabled && token && !gistId) {
        try {
            const records = await getAllRecords();
            const data = JSON.stringify(records, null, 2);
            const newGistId = await createGist(data);
            githubConfig.gistId = newGistId;
            localStorage.setItem('github_gist_id', newGistId);
            document.getElementById('gist-id').value = newGistId;
            alert('云同步已开启，数据已备份到GitHub！');
        } catch (error) {
            alert('创建Gist失败: ' + error.message);
            return;
        }
    }

    closeSettingsModal();
    updateSyncStatus();

    if (syncEnabled) {
        alert('云同步设置已保存！');
    } else {
        alert('云同步已关闭，数据将仅保存在本地。');
    }
}
