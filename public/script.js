// --- 元素選取與初始化保持不變 ---
const API_BASE = "/api";
// 手機模式：僅在「寬度 <900px 且主要輸入為觸控」時啟用，Mac/Windows 桌面（滑鼠/觸控板）一律維持原樣
const MOBILE_MODE_MQ = '(max-width: 900px) and (pointer: coarse)';
function isMobileMode() { return window.matchMedia(MOBILE_MODE_MQ).matches; }
async function createReservation(data) {
  const res = await fetch(`${API_BASE}/reservations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  const result = await res.json();
  if (!result.ok) throw new Error(result.msg);
  // 回傳完整的預約物件（含後端產生的 id），而非 {ok, data:{id}}
  return { id: result.data.id, ...data };
}

async function deleteReservation(id) {
  const res = await fetch(`${API_BASE}/reservations/${id}`, { method: "DELETE" });
  const result = await res.json();
  if (!result.ok) throw new Error(result.msg);
  return result;
}

async function batchDeleteByDate(dateStr) {
  const res = await fetch(`${API_BASE}/reservations/batch/date/${dateStr}`, { method: "DELETE" });
  const result = await res.json();
  if (!result.ok) throw new Error(result.msg);
  return result;
}

async function batchDeleteByMonth(ym) {
  const res = await fetch(`${API_BASE}/reservations/batch/month/${ym}`, { method: "DELETE" });
  const result = await res.json();
  if (!result.ok) throw new Error(result.msg);
  return result;
}

async function updateReservation(id, data) {
  const res = await fetch(`${API_BASE}/reservations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const result = await res.json();
  if (!result.ok) throw new Error(result.msg);
  return { id, ...data };
}
const monthYear = document.getElementById('monthYear');
const calendarDays = document.getElementById('day');
const prevbtn = document.getElementById('prevbtn');
const nextbtn = document.getElementById('nextbtn');
const viewSelect = document.getElementById('viewSelect');
const modalForm = document.getElementById('modalOverlay');
const bookBtn = document.querySelector('.btn-book');
const mainViewContainer = document.getElementById('mainViewContainer');
const monthView = document.getElementById('monthView');
const timelineView = document.getElementById('timelineView');
const timeColumn = document.getElementById('timeColumn');
const eventGrid = document.getElementById('eventGrid');
const viewDetailModal = document.getElementById('viewDetailModal');

let currentDate = new Date();
let eventsData = [];
let selectedDateStr = ""; 
let currentViewIndex = -1; // 用於追蹤當前查看的事件索引
let currentImportSkipList = [];
let currentImportInfoList = [];

// 複製/貼上預約（Outlook 式）：僅日期改變，時間/活動名/房間/負責人保持不變
let copiedEvent = null;
let pasteRequested = false;

// 房間顏色選擇器
let selectedColorRoom = '';

// 新增：回收站（從後端載入 is_deleted=1 的房間）
let trashRoomList = [];
let selectedCalendarDate = new Date(); // 記住使用者點擊/滑鼠hover的日期，預設今日

// 房間、員工 從後端載入，初始為空陣列
let roomList = [];
let empList = [];

// 篩選狀態
let filterEmployee = "";
let filterRooms = [];
function _isRoomFiltered(room) {
    return filterRooms.length > 0 && !filterRooms.includes(room);
}

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// 梵高油畫風格房間配色：互補色對比鮮明（紅綠/藍橙/黃紫），取深色系以確保白字可讀、觀感舒適
// 柔和高級感色系（低飽和、深色調，適合白字，共 20 色，橫跨全色相）
const ROOM_PALETTE = [
  '#9e5167', '#96793b', '#8a5a3a',           // 暖：玫瑰、蜂蜜、赭
  '#507d5d', '#6a7a52', '#5a7a72',           // 綠：鼠尾草、橄欖、青瓷
  '#4e7492', '#4a6880', '#5b6e8f',           // 藍：鋼藍、丹寧、板岩
  '#7a5685', '#6d5a90', '#8a5a70',           // 紫：梅子、薰衣草、玫瑰灰
  '#8c6d4a', '#6d5a4a', '#6d6e52',           // 土：可可、樹皮、苔
  '#3f7571', '#4a7d6b',                       // 青： teal、翠玉
  '#706078', '#80584a', '#505870'            // 中性灰調補充
];

// 房間配色持久化存儲
// 注意：Classroom 1 / Classroom 2 已永久刪除，不再由 server 重新建立；以下兩項僅作為「舊預約」的穩定配色參考
let roomColorMap = {
  "Classroom 1": { bg: "#4e749220", border: "#4e7492", label: "#4e7492" },
  "Classroom 2": { bg: "#96793b20", border: "#96793b", label: "#96793b" },
  "VIP Room":    { bg: "#9e516720", border: "#9e5167", label: "#9e5167" },
  "EDS":         { bg: "#3f757120", border: "#3f7571", label: "#3f7571" }
};

// localStorage 使用者自訂配色持久化（僅存使用者手動挑選過的房間）
const _UC_KEY = 'userColorOverrides';
function _loadUserOverrides() {
    try {
        const raw = localStorage.getItem(_UC_KEY);
        if (raw) {
            const o = JSON.parse(raw);
            Object.keys(o).forEach(k => { roomColorMap[k] = o[k]; });
        }
    } catch(e) {}
}
function _saveUserOverride(roomName) {
    try {
        const raw = localStorage.getItem(_UC_KEY);
        const o = raw ? JSON.parse(raw) : {};
        o[roomName] = roomColorMap[roomName];
        localStorage.setItem(_UC_KEY, JSON.stringify(o));
    } catch(e) {}
}
_loadUserOverrides();

// 頂部「房間」多選篩選下拉選單（全域）
function buildRoomMultiFilter() {
    const btn = document.getElementById('roomFilterBtn');
    const panel = document.getElementById('roomFilterPanel');
    const listEl = document.getElementById('roomFilterList');
    const allCb = document.getElementById('roomFilterAll');
    if (!btn || !panel || !listEl || !allCb) return;

    // 依 roomList 重建房間勾選清單
    listEl.innerHTML = roomList.map(r =>
        `<label class="multi-option"><input type="checkbox" value="${r.name.replace(/"/g, '&quot;')}">${r.name}</label>`
    ).join('');

    const labelEl = document.getElementById('roomFilterLabel');

    function refresh() {
        listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = filterRooms.includes(cb.value);
        });
        allCb.checked = filterRooms.length === 0;
        labelEl.textContent = filterRooms.length === 0 ? '全部房間' : `已選 ${filterRooms.length} 間`;
        btn.classList.toggle('has-selection', filterRooms.length > 0);
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block';
    };
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !btn.contains(e.target)) {
            panel.style.display = 'none';
        }
    });

    allCb.onchange = () => {
        if (allCb.checked) {
            filterRooms = [];
            _syncRoomChips();
        }
        refresh();
        updateView();
    };

    listEl.addEventListener('change', (e) => {
        const cb = e.target;
        if (cb.checked) {
            if (!filterRooms.includes(cb.value)) filterRooms.push(cb.value);
        } else {
            filterRooms = filterRooms.filter(v => v !== cb.value);
        }
        refresh();
        _syncRoomChips();
        updateView();
    });

    refresh();
}

// 依 filterRooms 同步左側邊欄房間色塊的選取狀態（不重建）
function _syncRoomChips() {
    const wrap = document.getElementById('roomChips');
    if (!wrap) return;
    wrap.querySelectorAll('.room-chip').forEach(el => {
        const room = el.dataset.room || '';
        if (room === '') {
            el.classList.toggle('active', filterRooms.length === 0);
        } else {
            el.classList.toggle('active', filterRooms.includes(room));
        }
    });
}

// 依 filterRooms 同步頂部多選下拉選單的顯示文字與勾選狀態（不重建）
function _refreshRoomMultiFilter() {
    const listEl = document.getElementById('roomFilterList');
    const allCb = document.getElementById('roomFilterAll');
    const labelEl = document.getElementById('roomFilterLabel');
    const btn = document.getElementById('roomFilterBtn');
    if (!listEl || !allCb || !labelEl || !btn) return;
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = filterRooms.includes(cb.value);
    });
    allCb.checked = filterRooms.length === 0;
    labelEl.textContent = filterRooms.length === 0 ? '全部房間' : `已選 ${filterRooms.length} 間`;
    btn.classList.toggle('has-selection', filterRooms.length > 0);
}

// 隨機生成房間配色函數：先順序取用未使用色，用完才循環
function generateRandomRoomColor() {
  const colorPool = ROOM_PALETTE;

  // 取出所有已經被佔用的 border 色
  const usedColors = Object.values(roomColorMap).map(item => item.border);
  // 篩選出還沒被使用的顏色
  const availableColors = colorPool.filter(color => !usedColors.includes(color));

  let border;
  if (availableColors.length > 0) {
    // 還有剩餘未使用顏色 → 從剩餘池隨機抽取，保證不重複
    border = availableColors[Math.floor(Math.random() * availableColors.length)];
  } else {
    // 20種全部用完，允許重複，隨機取全部池內顏色
    border = colorPool[Math.floor(Math.random() * colorPool.length)];
  }

  const bg = border + "20";
  return {
    bg,
    border,
    label: border
  };
}

// 取得房間配色，沒有就自動生成並存起來
function getRoomStyle(roomName) {
    // 用戶自訂 / 已持久化的配色優先（含色彩選擇器修改過的顏色）
    if (roomColorMap[roomName]) return roomColorMap[roomName];
    // 內建房間初始預設（僅在 roomColorMap 尚無此房間時生效）
    const builtInRooms = {
        "VIP Room":    { bg: "#9e516720", border: "#9e5167", label: "#9e5167" },
        "EDS":         { bg: "#3f757120", border: "#3f7571", label: "#3f7571" }
    };
    if(builtInRooms[roomName]){
        return builtInRooms[roomName];
    }

    if (!roomColorMap[roomName]) {
        const color = generateRandomRoomColor();
        roomColorMap[roomName] = color;
        // 持久化到後端，確保刷新後顏色不變
        const room = roomList.find(r => r.name === roomName);
        if (room && room.id) {
            fetch(`${API_BASE}/rooms/${room.id}/color`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ colorData: JSON.stringify(color) })
            }).catch(() => {});
        }
    }
    return roomColorMap[roomName];
}

// 自訂密碼輸入彈窗（含隱藏/顯示切換）
function showPasswordPrompt(message){
    return new Promise(resolve => {
        const mask = document.createElement('div');
        mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;';
        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:10px;padding:24px 28px;width:340px;box-shadow:0 8px 30px rgba(0,0,0,0.25);font-family:sans-serif;';
        box.innerHTML = `
            <div style="font-size:14px;margin-bottom:14px;color:#333;">${message}</div>
            <div style="position:relative;margin-bottom:16px;">
                <input id="pwdModalInput" type="password" placeholder="請輸入密碼" style="width:100%;padding:10px 42px 10px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;" />
                <button id="pwdToggleBtn" type="button" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:18px;color:#888;padding:4px;" title="顯示/隱藏密碼">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button id="pwdCancelBtn" style="padding:8px 18px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">取消</button>
                <button id="pwdOkBtn" style="padding:8px 18px;border:none;border-radius:6px;background:#7c5cbf;color:#fff;cursor:pointer;font-size:13px;">確定</button>
            </div>`;
        mask.appendChild(box);
        document.body.appendChild(mask);

        const input = document.getElementById('pwdModalInput');
        const toggleBtn = document.getElementById('pwdToggleBtn');
        const okBtn = document.getElementById('pwdOkBtn');
        const cancelBtn = document.getElementById('pwdCancelBtn');
        input.focus();

        toggleBtn.onclick = () => {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            toggleBtn.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
        };
        const close = (val) => { mask.remove(); resolve(val); };
        okBtn.onclick = () => close(input.value);
        cancelBtn.onclick = () => close(null);
        input.onkeydown = (e) => { if(e.key === 'Enter') close(input.value); if(e.key === 'Escape') close(null); };
        mask.onclick = (e) => { if(e.target === mask) close(null); };
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.__CAL_BOOKING_INIT_DONE__) { console.warn('[INIT] 已初始化過，跳過重複執行'); return; }
    window.__CAL_BOOKING_INIT_DONE__ = true;
    console.log('[IMPORT] script version v20260731c (importArmed gate)');
    loadAllData();
    initSidebarToggle();
    renderAnnouncement();
    initFilterDropdowns();
    // 頁面一載入直接隱藏「當日」選項
    if(!monthYear || !calendarDays){
    console.warn("缺少核心DOM元素，日曆無法初始化");
    return;
}
    const optDay = document.getElementById("optDayRange");
    optDay.style.display = "none";

    // 開頁自動檢查回收站
    /*if(trashRoomList.length > 0){
        let tipText = "系統偵測到回收站尚有已刪除房間：\n";
        trashRoomList.forEach(item => {
            tipText += `· ${item.name}\n`;
        })
        tipText += "\n點擊「確定」永久清空全部，點擊「取消」保留，可至設定面板手動恢復/刪除";
        const clearAll = confirm(tipText);
        if(clearAll){
            trashRoomList.forEach(item => {
                delete roomColorMap[item.name];
            })
            trashRoomList = [];
            localStorage.setItem("trashRoomList", JSON.stringify(trashRoomList));
            localStorage.setItem("roomColorMap", JSON.stringify(roomColorMap));
            alert("已永久清空回收站所有房間");
        }
    }*/
    
    // 監聽視圖與導航
    if(viewSelect){
        viewSelect.addEventListener('change', updateView);
    }
    if(prevbtn){
        prevbtn.onclick = () => changeDate(-1);
    }
    if(nextbtn){
    nextbtn.onclick = () => changeDate(1);
}
    const thisMonthBtn = document.getElementById('thisMonthBtn');
    if(thisMonthBtn){
        thisMonthBtn.onclick = () => {
            const today = new Date();
            currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
            selectedCalendarDate = new Date(today);
            viewSelect.value = 'month';
            viewSelect.dispatchEvent(new Event('change'));
        };
    }
    
    // --- 修正關閉彈窗邏輯 ---
    const allCloseBtns = document.querySelectorAll('.btn-close-view');
    allCloseBtns.forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const modal = btn.closest('.modal-overlay');
            if (modal) {
                modal.classList.remove('active');
            }
        };
    });

    // 點擊背景空白處關閉彈窗
    window.onclick = (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            e.target.classList.remove('active');
        }
    };

    // 詳情視窗內的 ✏️ 編輯
    const btnEditDetail = document.getElementById('btnEditDetail');
if(btnEditDetail){
    btnEditDetail.onclick = () => {
        const modal = document.getElementById('viewDetailModal');
        modal.classList.remove('active');
        const ev = eventsData[currentViewIndex];
        openBookingForm(ev.date, currentViewIndex);
    };
}

    // 詳情視窗內的 🗑️ 刪除
    const btnDeleteDetail = document.getElementById('btnDeleteDetail');
if(btnDeleteDetail){
    btnDeleteDetail.onclick = async () => {
        if (!clickGuard(btnDeleteDetail)) return;
        const ev = eventsData[currentViewIndex];
        if (confirm(`確定要刪除「${ev.name}」的預約嗎？`)) {
            try {
                if (ev.id) await deleteReservation(ev.id);
                eventsData.splice(currentViewIndex, 1);
                document.getElementById('viewDetailModal').classList.remove('active');
                updateView();
            } catch(err) {
                alert("刪除失敗：" + err.message);
            }
        }
    };
}
// 詳情視窗內的 查看備註
const btnViewNote = document.getElementById('btnViewNote');
if(btnViewNote){
    btnViewNote.onclick = () => {
        const ev = eventsData[currentViewIndex];
        document.getElementById('noteText').innerText = (ev && ev.note) ? ev.note : '（無備註）';
        document.getElementById('noteModal').classList.add('active');
    };
}

// ===== 複製/貼上預約（Outlook 式）=====
function showPasteBar() {
    const bar = document.getElementById('pasteBar');
    if (!bar || !copiedEvent) return;
    const textEl = document.getElementById('pasteBarText');
    const timeStr = copiedEvent.startTime ? `${copiedEvent.startTime}-${copiedEvent.endTime}` : '全天';
    textEl.textContent = `已複製：${copiedEvent.name}｜${copiedEvent.room} ${timeStr}`;
    const dateInput = document.getElementById('pasteDateInput');
    if (dateInput && !dateInput.value) {
        dateInput.value = selectedDateStr || getTodayStr();
    }
    bar.style.display = 'flex';
}
function hidePasteBar() {
    const bar = document.getElementById('pasteBar');
    if (bar) bar.style.display = 'none';
}
function copyEventToClipboard(ev) {
    copiedEvent = { ...ev };
    delete copiedEvent.id;
    pasteRequested = false;
    showPasteBar();
}

// 詳情視窗內的 🧾 複製按鈕
const btnCopyDetail = document.getElementById('btnCopyDetail');
if(btnCopyDetail){
    btnCopyDetail.onclick = () => {
        const ev = eventsData[currentViewIndex];
        if (!ev) return;
        copyEventToClipboard(ev);
        btnCopyDetail.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => { btnCopyDetail.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 1500);
    };
}

// 貼上浮動列按鈕
const pasteApplyBtn = document.getElementById('pasteApplyBtn');
if(pasteApplyBtn){
    pasteApplyBtn.onclick = () => {
        if (!copiedEvent) return;
        const dateInput = document.getElementById('pasteDateInput');
        const target = dateInput && dateInput.value ? dateInput.value : (selectedDateStr || getTodayStr());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) { alert("請選擇有效的目標日期"); return; }
        pasteRequested = true;
        openBookingForm(target);
    };
}
const pasteClearBtn = document.getElementById('pasteClearBtn');
if(pasteClearBtn){
    pasteClearBtn.onclick = () => {
        copiedEvent = null;
        pasteRequested = false;
        hidePasteBar();
    };
}

// 鍵盤快捷鍵：Ctrl+C 複製詳情視窗中的預約；Ctrl+V 貼上
document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || document.activeElement && document.activeElement.isContentEditable;
    if (e.ctrlKey || e.metaKey) {
        if ((e.key === 'c' || e.key === 'C') && viewDetailModal.classList.contains('active') && !inField) {
            e.preventDefault();
            const ev = eventsData[currentViewIndex];
            if (ev) { copyEventToClipboard(ev); }
        } else if ((e.key === 'v' || e.key === 'V') && copiedEvent && !inField) {
            e.preventDefault();
            pasteRequested = true;
            openBookingForm(selectedDateStr || getTodayStr());
        }
    }
});

// 複製備註（含 Windows/非 HTTPS 環境 fallback）
function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).then(() => true, () => false);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let success = false;
    try { success = document.execCommand('copy'); } catch(e) { success = false; }
    document.body.removeChild(ta);
    return Promise.resolve(success);
}
const copyNoteBtn = document.getElementById('copyNoteBtn');
if(copyNoteBtn){
    copyNoteBtn.onclick = async () => {
        const text = document.getElementById('noteText').innerText;
        const ok = await copyTextToClipboard(text);
        copyNoteBtn.textContent = ok ? '已複製！' : '複製失敗，請手動選取文字複製';
        setTimeout(() => { copyNoteBtn.textContent = 'Copy'; }, 2000);
    };
}

// 一次性載入預約、房間、員工全域數據
async function loadAllData() {
    showLoading();
    try {
        // 載入預約
        const evRes = await fetch(`${API_BASE}/reservations`);
        const evJson = await evRes.json();
        if (evJson.ok) eventsData = evJson.data;

        // 載入有效房間（含配色、縮寫）
        const roomRes = await fetch(`${API_BASE}/rooms`);
        const roomJson = await roomRes.json();
        if (roomJson.ok) {
            roomList = roomJson.data;
            // 同步 roomColorMap
            roomList.forEach(r => {
                if (r.colorData) {
                    try { roomColorMap[r.name] = JSON.parse(r.colorData); } catch(e) {}
                }
            });
            // 遷移：舊版高飽和色系一律重配成柔和低飽和色系，並持久化（內建房間由 getRoomStyle 覆蓋，不在此處理）
            const paletteSet = new Set(ROOM_PALETTE.map(c => c.toLowerCase()));
            const builtInNames = ['VIP Room', 'EDS'];
            roomList.forEach(r => {
                if (!r.colorData || builtInNames.includes(r.name)) return;
                let c; try { c = JSON.parse(r.colorData); } catch(e) { return; }
                if (!c || !c.border || paletteSet.has(String(c.border).toLowerCase())) return;
                const color = generateRandomRoomColor();
                roomColorMap[r.name] = color;
                if (r.id) fetch(`${API_BASE}/rooms/${r.id}/color`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ colorData: JSON.stringify(color) })
                }).catch(() => {});
            });
            // API sync 完成後，重新套用使用者自訂配色（確保使用者手動挑選的顏色不被遷移覆蓋）
            _loadUserOverrides();
        }

        // 載入回收站（is_deleted=1 的房間）
        const allRoomRes = await fetch(`${API_BASE}/rooms/all`);
        const allRoomJson = await allRoomRes.json();
        if (allRoomJson.ok) {
            trashRoomList = allRoomJson.data.filter(r => r.is_deleted === 1);
        }

        // 載入員工
        const empRes = await fetch(`${API_BASE}/employees`);
        const empJson = await empRes.json();
        if (empJson.ok) empList = empJson.data;

        await loadTodos();
        await loadLeaves();
        await loadHolidays(currentDate.getFullYear());

        updateView();
        initFilterDropdowns();
        renderRoomChips();
        renderMiniCalendar();
        initSidebarToggle();
    } catch (err) {
        console.error("載入後端數據失敗：", err);
    } finally {
        hideLoading();
    }
}

// 初始化篩選下拉選單
function initFilterDropdowns() {
    const filterEmp = document.getElementById('filterEmployee');
    if (filterEmp) {
        filterEmp.innerHTML = '<option value="">全部員工</option>';
        empList.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.name;
            opt.textContent = emp.name;
            filterEmp.appendChild(opt);
        });
        filterEmp.onchange = (e) => {
            filterEmployee = e.target.value;
            updateView();
        };
    }
    buildRoomMultiFilter();
}

// 取得篩選後的事件列表
function getFilteredData() {
    return eventsData.filter(ev => {
        if (filterEmployee && ev.employee !== filterEmployee) return false;
        if (_isRoomFiltered(ev.room)) return false;
        return true;
    });
}
    // ========== 設定面板邏輯 ==========
    const settingBtn = document.getElementById('settingBtn');
    const settingModal = document.getElementById('settingModal');
    const roomListWrap = document.getElementById('roomListWrap');
    const empListWrap = document.getElementById('empListWrap');
    const newRoomInput = document.getElementById('newRoomInput');
    const newEmpInput = document.getElementById('newEmpInput');
    const addRoomBtn = document.getElementById('addRoomBtn');
    const addEmpBtn = document.getElementById('addEmpBtn');

        // ========== 匯出功能邏輯 ==========
    const exportBtn = document.getElementById('exportBtn');
    const exportModal = document.getElementById('exportModal');
    const exportRange = document.getElementById('exportRange');
    const exportType = document.getElementById('exportType');
    const startExportBtn = document.getElementById('startExportBtn');
    
    //匯入功能編輯
    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    const importTipBtn = document.querySelector('.import-tip-btn');

    let importArmed = false;
    if(importBtn){
    importBtn.onclick = () => {
        // 每次點擊匯入，清空上一次的跳過與提醒記錄
    currentImportSkipList = [];
    currentImportInfoList = [];
        importArmed = true;
        importFileInput.click();
    };
    }

    if(importTipBtn){
    importTipBtn.onclick = (e) => {
        e.stopPropagation();
        // 固定前置格式說明，每次點擊都顯示
        let tipText = "【Excel匯入格式規範】\n支援多Sheet匯入，系統會自動偵測每個Sheet的欄位：\n\n📋 Sheet 1「預約」欄位：日期、活動名稱、預約員工、房間、開始時間、結束時間（跨日預約結束時間早於開始時間時自動視為隔日結束）\n📋 舊版「預約」格式亦支援：日期（含星期）、活動名、時段（全日/am/pm）、房間、負責人\n📋 Sheet 2「待辦事項」欄位：標題、開始日期、結束日期、開始時間、結束時間、房間、負責人、全日\n📋 Sheet 3「公眾假期」由系統自動抓取，無需匯入\n📋 Sheet 4「員工假期」欄位：員工姓名、開始日期、結束日期(同日=單日)、假期類型(選填)\n\n時間格式：09:00、23:30\n日期格式：2026-01-15（舊格式亦支援 1/03/2025（Fri））\n\n";

        if(currentImportInfoList.length > 0){
            tipText += "=== 本次匯入資訊提醒 ===\n\n";
            tipText += currentImportInfoList.join("\n");
            tipText += "\n\n";
        }

        if(currentImportSkipList.length > 0){
            // 有異常：規範 + 完整錯誤清單
            tipText += "=== 本次匯入所有跳過異常清單 ===\n\n";
            tipText += currentImportSkipList.join("\n");
        }else{
            // 無異常：只顯示規範+無錯提示
            tipText += "本次匯入無任何跳過異常記錄";
        }
        alert(tipText);
    };
}

    let importProcessing = false;
    let lastImportFp = '';
    let importLastTime = 0;
    let importRunId = 0;
    importFileInput.addEventListener('change', async (e) => {
        const now = Date.now();
        console.log(`[IMPORT] change 觸發 armed=${importArmed} time=${now} lastTime=${importLastTime} diff=${now-importLastTime}`);
        if (!importArmed) { console.warn('[IMPORT] 已阻擋非使用者觸發的檔案變更'); return; }
        importArmed = false;
        const file = e.target.files[0];
        if (!file) return;
        const fp = `${file.name}|${file.size}|${file.lastModified}`;
        if (importProcessing) { console.warn('[IMPORT] 已阻擋重複觸發（處理中）:', fp); return; }
        if (fp === lastImportFp && Date.now() - importLastTime < 1500) { console.warn('[IMPORT] 已阻擋短時間內相同檔案重複觸發:', fp); return; }
        lastImportFp = fp;
        importLastTime = Date.now();
        importProcessing = true;
        importRunId++;
        const runId = importRunId;
        console.log(`[IMPORT] 開始處理 runId=${runId} fp=${fp}`);
        
        const reader = new FileReader();
        reader.onload = async function(evt) {
            try {
                console.log(`[IMPORT] runId=${runId} 檔案讀取完成，開始解析`);
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                await loadAllData();
                
                let totalSuccess = 0, totalSkip = 0, newRoomCount = 0, newEmpCount = 0;
                const allSkipList = [];
                const allInfoNotes = [];
                let todoDataRowsFound = false;
                const allNewRooms = new Set();
                const allNewEmps = new Set();

                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    if (rawData.length < 2) continue;

                    const headerRow = rawData[0];
                    const headers = headerRow.map(h => String(h || '').trim().toLowerCase());

                    if (headers.includes('時段') && (headers.includes('活動名') || headers.includes('活動名稱')) && headers.includes('房間') && !headers.includes('開始時間')) {
                        // === 舊格式預約 SHEET（日期含星期／活動名／時段／房間／負責人） ===
                        const headerMap = {};
                        headerRow.forEach((h, i) => {
                            const key = String(h || '').trim();
                            if (key === '日期' || key === 'date') headerMap.date = i;
                            else if (key === '活動名' || key === '活動名稱' || key === 'name') headerMap.name = i;
                            else if (key === '時段' || key === 'session') headerMap.session = i;
                            else if (key === '房間' || key === 'room') headerMap.room = i;
                            else if (key === '負責人' || key === 'employee') headerMap.employee = i;
                        });
                        const importList = [];
                        rawData.slice(1).forEach((row, rawIdx) => {
                            const excelRow = rawIdx + 2;
                            if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) return;
                            const get = (key) => headerMap[key] !== undefined ? row[headerMap[key]] : undefined;
                            const dateRaw = get('date'); const name = get('name'); const employee = get('employee');
                            const room = get('room'); const sessionRaw = get('session');
                            if (dateRaw === undefined || !name || !employee || !room || sessionRaw === undefined) {
                                totalSkip++; allSkipList.push(`[預約]第${excelRow}行：欄位不全`); return;
                            }
                            const dateStr = legacyDateToStr(dateRaw);
                            if (!dateStr) { totalSkip++; allSkipList.push(`[預約]第${excelRow}行「${name}」：日期格式無法辨識「${dateRaw}」`); return; }
                            const slot = sessionToTimes(sessionRaw);
                            if (!slot) { totalSkip++; allSkipList.push(`[預約]第${excelRow}行「${name}」：時段「${sessionRaw}」無法辨識（請用 全日/am/pm）`); return; }
                            const roomName = String(room).trim(); const empName = String(employee).trim();
                            if (!roomList.some(item => item.name === roomName) && !allNewRooms.has(roomName)) { allNewRooms.add(roomName); newRoomCount++; }
                            if (!empList.some(e => e.name === empName) && !allNewEmps.has(empName)) { allNewEmps.add(empName); newEmpCount++; }
                            const isConflict = eventsData.some(ev => {
                                const evEnd = ev.endDate || ev.date;
                                return ev.room === roomName && (dateStr+'T'+slot.sTime) < (evEnd+'T'+ev.endTime) && (dateStr+'T'+slot.eTime) > (ev.date+'T'+ev.startTime);
                            });
                            if (isConflict) { totalSkip++; allSkipList.push(`[預約]第${excelRow}行「${name}」：${dateStr} ${roomName} 時段衝突`); return; }
                            importList.push({ date: dateStr, endDate: dateStr, name: String(name).trim(), employee: empName, room: roomName, startTime: slot.sTime, endTime: slot.eTime, note: '', row: excelRow });
                            totalSuccess++;
                        });
                        if (importList.length > 0) {
                            try { const res = await fetch(`${API_BASE}/reservations/batch`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({list:importList}) }); const result = await res.json(); if (!result.ok) { totalSkip += importList.length; allSkipList.push("[預約]批量匯入失敗："+result.msg); } else if (result.fail > 0) { totalSuccess -= result.fail; totalSkip += result.fail; if (result.failDetails) result.failDetails.forEach(d => allSkipList.push("[預約]"+d)); } } catch(err) { totalSkip += importList.length; allSkipList.push("[預約]批量匯入失敗："+err.message); }
                        }

                    } else if (headers.includes('活動名稱') || headers.includes('預約員工') || headers.includes('預約人')) {
                        // === RESERVATION SHEET ===
                        const headerMap = {};
                        headerRow.forEach((h, i) => {
                            const key = String(h || '').trim();
                            if (key === '日期' || key === 'date') headerMap.date = i;
                            else if (key === '活動名稱' || key === '名稱' || key === 'name') headerMap.name = i;
                            else if (key === '預約員工' || key === '預約人' || key === 'employee') headerMap.employee = i;
                            else if (key === '房間' || key === 'room') headerMap.room = i;
                            else if (key === '開始時間' || key === 'startTime' || key === 'start') headerMap.startTime = i;
                            else if (key === '結束時間' || key === 'endTime' || key === 'end') headerMap.endTime = i;
                            else if (key === '備註' || key === 'note') headerMap.note = i;
                        });
                        const importList = [];
                        rawData.slice(1).forEach((row, rawIdx) => {
                            const excelRow = rawIdx + 2;
                            if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) return;
                            const get = (key) => headerMap[key] !== undefined ? row[headerMap[key]] : undefined;
                            const dateRaw = get('date'); const name = get('name'); const employee = get('employee');
                            const room = get('room'); const startRaw = get('startTime'); const endRaw = get('endTime');
                            const note = headerMap.note !== undefined ? String(row[headerMap.note] ?? '').trim() : '';
                            if (dateRaw === undefined || !name || !employee || !room || startRaw === undefined || endRaw === undefined) {
                                totalSkip++; allSkipList.push(`[預約]第${excelRow}行：欄位不全`); return;
                            }
                            const dateStr = excelDateToStr(dateRaw);
                            const sTime = excelTimeToStr(startRaw);
                            const eTime = excelTimeToStr(endRaw);
                            let importEndDate = dateStr;
                            if (sTime >= eTime) {
                                const nextDay = new Date(dateStr); nextDay.setDate(nextDay.getDate() + 1);
                                importEndDate = getFormattedDate(nextDay);
                            }
                            const roomName = String(room).trim(); const empName = String(employee).trim();
                            if (!roomList.some(item => item.name === roomName) && !allNewRooms.has(roomName)) { allNewRooms.add(roomName); newRoomCount++; }
                            if (!empList.some(e => e.name === empName) && !allNewEmps.has(empName)) { allNewEmps.add(empName); newEmpCount++; }
                            const isConflict = eventsData.some(ev => {
                                const evEnd = ev.endDate || ev.date;
                                return ev.room === roomName && (dateStr+'T'+sTime) < (evEnd+'T'+ev.endTime) && (importEndDate+'T'+eTime) > (ev.date+'T'+ev.startTime);
                            });
                            if (isConflict) { totalSkip++; allSkipList.push(`[預約]第${excelRow}行「${name}」：${dateStr} ${roomName} 時段衝突`); return; }
                            importList.push({ date: dateStr, endDate: importEndDate, name: String(name).trim(), employee: empName, room: roomName, startTime: sTime, endTime: eTime, note, row: excelRow });
                            totalSuccess++;
                        });
                        if (importList.length > 0) {
                            try { const res = await fetch(`${API_BASE}/reservations/batch`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({list:importList}) }); const result = await res.json(); if (!result.ok) { totalSkip += importList.length; allSkipList.push("[預約]批量匯入失敗："+result.msg); } else if (result.fail > 0) { totalSuccess -= result.fail; totalSkip += result.fail; if (result.failDetails) result.failDetails.forEach(d => allSkipList.push("[預約]"+d)); } } catch(err) { totalSkip += importList.length; allSkipList.push("[預約]批量匯入失敗："+err.message); }
                        }

                    } else if (headers.includes('標題') || headers.includes('開始日期')) {
                        // === TODO SHEET ===
                        todoDataRowsFound = true;
                        const headerMap = {};
                        headerRow.forEach((h, i) => {
                            const key = String(h || '').trim();
                            if (key === '標題' || key === 'title') headerMap.title = i;
                            else if (key === '開始日期') headerMap.startDate = i;
                            else if (key === '結束日期') headerMap.endDate = i;
                            else if (key === '開始時間') headerMap.startTime = i;
                            else if (key === '結束時間') headerMap.endTime = i;
                            else if (key === '房間') headerMap.room = i;
                            else if (key === '負責人') headerMap.employee = i;
                            else if (key === '全日') headerMap.isAllDay = i;
                        });
                        for (const row of rawData.slice(1)) {
                            if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
                            const get = (key) => headerMap[key] !== undefined ? row[headerMap[key]] : undefined;
                            const title = get('title'); const startDateRaw = get('startDate');
                            if (!title || !startDateRaw) { allInfoNotes.push(`[待辦]缺少標題或開始日期`); continue; }
                            const startDate = excelDateToStr(startDateRaw);
                            const endDateRaw = get('endDate'); const endDate = endDateRaw ? excelDateToStr(endDateRaw) : startDate;
                            const startTime = get('startTime') ? excelTimeToStr(get('startTime')) : '';
                            const endTime = get('endTime') ? excelTimeToStr(get('endTime')) : '';
                            const room = get('room') ? String(get('room')).trim() : '';
                            const employee = get('employee') ? String(get('employee')).trim() : '';
                            const isAllDayRaw = get('isAllDay');
                            const isAllDay = (isAllDayRaw === '是' || isAllDayRaw === true || isAllDayRaw === 1) ? 1 : 0;
                            // Check for duplicate
                            const isDuplicate = todosData.some(t =>
                                t.title === title && t.startDate === startDate && t.endDate === endDate &&
                                (t.startTime||'') === startTime && (t.endTime||'') === endTime &&
                                (t.room||'') === room && (t.employee||'') === employee
                            );
                            if (isDuplicate) { totalSkip++; allSkipList.push(`[待辦]「${title}」${startDate} 已存在，跳過`); continue; }
                            try { await fetch(`${API_BASE}/todos`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({title,startDate,endDate,startTime,endTime,room,employee,isAllDay}) }); totalSuccess++; } catch(err) { totalSkip++; allSkipList.push(`[待辦]「${title}」匯入失敗：${err.message}`); }
                        }

                    } else if (headers.includes('名稱') && headers.includes('日期') && !headers.includes('活動名稱')) {
                        allInfoNotes.push('[假期]假期資料由系統自動抓取，無需匯入');

                    } else if (headers.includes('員工姓名') && (headers.includes('日期') || headers.includes('開始日期'))) {
                        // === EMPLOYEE LEAVE SHEET ===
                        const headerMap = {};
                        headerRow.forEach((h, i) => {
                            const key = String(h || '').trim();
                            if (key === '員工姓名' || key === '員工') headerMap.employee = i;
                            else if (key === '開始日期' || key === '日期') headerMap.leaveDate = i;
                            else if (key === '結束日期' || key === 'endDate') headerMap.endDate = i;
                            else if (key === '假期類型' || key === '類型') headerMap.leaveType = i;
                        });
                        const leaveList = [];
                        for (const row of rawData.slice(1)) {
                            if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;
                            const get = (key) => headerMap[key] !== undefined ? row[headerMap[key]] : undefined;
                            const employee = get('employee'); const leaveDateRaw = get('leaveDate');
                            if (!employee || !leaveDateRaw) { totalSkip++; allSkipList.push(`[員工假期]缺少員工或日期`); continue; }
                            const leaveDate = excelDateToStr(leaveDateRaw);
                            const endDateRaw = get('endDate');
                            const endDate = endDateRaw ? excelDateToStr(endDateRaw) : leaveDate;
                            const leaveType = get('leaveType') ? String(get('leaveType')).trim() : '';
                            const empName = String(employee).trim();
                            if (!empList.some(e => e.name === empName) && !allNewEmps.has(empName)) { allNewEmps.add(empName); newEmpCount++; }
                            const isDuplicate = leavesData.some(l => l.employee === empName && l.leaveDate === leaveDate && (l.endDate || l.leaveDate) === endDate);
                            if (isDuplicate) { totalSkip++; allSkipList.push(`[員工假期]${empName} ${leaveDate}${endDate !== leaveDate ? ' ~ '+endDate : ''} 已存在，跳過`); continue; }
                            leaveList.push({ employee: empName, leaveDate, endDate, leaveType });
                            totalSuccess++;
                        }
                        if (leaveList.length > 0) {
                            try { const res = await fetch(`${API_BASE}/employee-leaves/batch`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({list:leaveList}) }); const result = await res.json(); if (!result.ok) { totalSkip += leaveList.length; allSkipList.push("[員工假期]批量匯入失敗："+result.msg); } else if (result.fail > 0) { totalSuccess -= result.fail; totalSkip += result.fail; } } catch(err) { totalSkip += leaveList.length; allSkipList.push("[員工假期]批量匯入失敗："+err.message); }
                        }
                    }
            }
            for (const rName of allNewRooms) { try { const color = generateRandomRoomColor(); await fetch(`${API_BASE}/rooms`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({name:rName,short:'',colorData:JSON.stringify(color)}) }); } catch(e) {} }
            for (const eName of allNewEmps) { try { await fetch(`${API_BASE}/employees`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({name:eName}) }); } catch(e) {} }

            await loadAllData();
            await loadHolidays(new Date().getFullYear());
            updateView();

            if (!todoDataRowsFound) allInfoNotes.push('[待辦]未加入待辦事項');
            currentImportInfoList = [...allInfoNotes];
            currentImportSkipList = [...allSkipList];
            let resultMsg = `匯入完成！\n✅ 成功：${totalSuccess} 條\n⚠️ 跳過：${totalSkip} 條`;
            if (newRoomCount > 0) resultMsg += `\n🏠 自動新增房間：${newRoomCount} 個`;
            if (newEmpCount > 0) resultMsg += `\n👤 自動新增員工：${newEmpCount} 位`;
            if (allInfoNotes.length > 0) resultMsg += `\nℹ️ 資訊提醒：${allInfoNotes.length} 條（點「i」查看）`;
            if (allSkipList.length > 0) {
                resultMsg += totalSuccess === 0
                    ? `\n\n⚠️ 所有數據均跳過，極可能Excel欄位格式不匹配！\n點擊匯入旁邊「i」小按鈕查看完整錯誤原因`
                    : `\n\n點擊匯入旁邊「i」小按鈕可查看全部跳過異常明細`;
            }
            resultMsg += `\n\n[DEBUG runId=${runId} v20260731e]`;
            console.log(`[IMPORT] runId=${runId} 顯示結果 alert：成功=${totalSuccess} 跳過=${totalSkip}`);
            alert(resultMsg);
        } catch (err) {
                console.error(err);
                alert("匯入失敗：檔案格式錯誤，請確認是標準 .xlsx 檔案");
            } finally {
                importFileInput.value = "";
                importProcessing = false;
            }
        };
        reader.onerror = () => { importFileInput.value = ""; importProcessing = false; };
        reader.readAsArrayBuffer(file);
    });

    // 打開匯出彈窗
    if(exportBtn){
exportBtn.onclick = () => {

    // 同步灰化規則
    syncExportRangeOptionState();

    // 每次點擊匯出，強制重置選單為「當前顯示月份」
    //exportRange.value = "currentMonth";

    // 依據當前視圖隱藏/顯示當日選項
    const currentView = viewSelect.value;
    const dayOption = document.getElementById("optDayRange");
    if (currentView === "day") {
        dayOption.style.display = "block";
    } else {
        dayOption.style.display = "none";
    }
    exportModal.classList.add('active');
}
    }

// 執行匯出
if(startExportBtn){
startExportBtn.onclick = () => {
    const range = exportRange.value;
    const type = exportType.value;
    let invalid = false;
    const currentView = viewSelect.value;

    if(currentView === "month" && ["currentWeek","currentDay"].includes(range)) invalid = true;
    if(currentView === "week" && ["currentMonth","currentDay"].includes(range)) invalid = true;
    if(currentView === "day" && ["currentMonth","currentWeek"].includes(range)) invalid = true;

    if(invalid){
        alert("匯出範圍與當前視圖不匹配，請重新選擇！");
        return;
    }

    exportModal.classList.remove('active');
    if(type === 'excel'){
        exportExcel(range);
    }else{
        exportPdf(range);
    }
}
}
        
        // 批量刪除垃圾桶按鈕
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if(batchDeleteBtn){
    batchDeleteBtn.onclick = async function(){
        if (!clickGuard(batchDeleteBtn)) return;
        const inputBinPwd = await showPasswordPrompt("請輸入管理密碼，進入批量刪除功能：");
        if(inputBinPwd === null) return;
        try {
            const loginRes = await fetch(`${API_BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: inputBinPwd }) });
            const loginData = await loginRes.json();
            if (!loginData.ok) { alert("密碼錯誤，無法進入批量刪除"); return; }
        } catch(e) { alert("驗證失敗：" + e.message); return; }

        // ===== 密碼驗證通過，執行刪除彈窗 =====
        const currentView = viewSelect.value;
        // 建立浮動彈窗
        const mask = document.createElement('div');
        mask.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.4);z-index:9999;
            display:flex;align-items:center;justify-content:center;
        `;
        const box = document.createElement('div');
        box.style.cssText = `
            background:#fff;padding:24px;border-radius:10px;min-width:320px;
        `;
        box.innerHTML = `
            <h3 style="margin:0 0 20px 0;color:#c0392b;">⚠️ 危險操作：批量刪除預約</h3>
            <div style="display:flex;flex-direction:column;gap:12px;">
                <button id="delMonthBtn" style="padding:10px;border:none;border-radius:6px;background:#e74c3c;color:white;cursor:pointer;">清除本月所有預約</button>
                <button id="delDayBtn" style="padding:10px;border:none;border-radius:6px;background:#e74c3c;color:white;cursor:pointer;">清除當日所有預約</button>
                <button id="closeBatchModal" style="padding:10px;border:1px solid #aaa;border-radius:6px;background:#fff;cursor:pointer;margin-top:8px;">取消</button>
            </div>
        `;
        mask.appendChild(box);
        document.body.appendChild(mask);

        const delMonthBtn = document.getElementById('delMonthBtn');
        const delDayBtn = document.getElementById('delDayBtn');
        const closeBtn = document.getElementById('closeBatchModal');

        // 視圖規則限制
        if(currentView === "month"){
            delDayBtn.disabled = true;
            delDayBtn.style.opacity = "0.45";
            delDayBtn.style.cursor = "not-allowed";
            delDayBtn.title = "切換至【Day/Week】視圖才能刪除單日";
        }else{
            delMonthBtn.disabled = true;
            delMonthBtn.style.opacity = "0.45";
            delMonthBtn.style.cursor = "not-allowed";
            delMonthBtn.title = "切換至【Month】月視圖才能刪除整月";
        }

        // 關閉彈窗
        function closeModal(){
            mask.remove();
        }
        closeBtn.onclick = closeModal;
        mask.onclick = (e) => {
            if(e.target === mask) closeModal();
        };

        // 清除本月
        delMonthBtn.onclick = async function(){
            if (!clickGuard(delMonthBtn)) return;
            const ymInfo = getCurrentViewYM();
            const targetYear = ymInfo.year;
            const targetMonth = ymInfo.month;
            const ym = `${targetYear}-${String(targetMonth+1).padStart(2,'0')}`;
            const ok = confirm(`⚠️ 永久刪除【${targetYear}年${targetMonth+1}月】全部預約？\n此操作無法復原！`);
            if(!ok) return;
            try {
                await batchDeleteByMonth(ym);
                eventsData = eventsData.filter(e=>{
                    const d = new Date(e.date);
                    return !(d.getFullYear() === targetYear && d.getMonth() === targetMonth);
                });
                updateView();
                closeModal();
                alert("本月預約已全部刪除");
            } catch(err) {
                alert("刪除失敗：" + err.message);
            }
        };

        // 清除當日
        delDayBtn.onclick = async function(){
            if (!clickGuard(delDayBtn)) return;
            const targetDateStr = getFormattedDate(selectedCalendarDate);
            const ok = confirm(`⚠️ 永久刪除【${targetDateStr}】所有預約？\n此操作無法復原！`);
            if(!ok) return;
            try {
                await batchDeleteByDate(targetDateStr);
                eventsData = eventsData.filter(e => e.date !== targetDateStr);
                updateView();
                closeModal();
                alert("當日預約已全部刪除");
            } catch(err) {
                alert("刪除失敗：" + err.message);
            }
        };
    };
    }
    // 打開設定視窗
    if(settingBtn){
    settingBtn.onclick = async () => {
    if (!clickGuard(settingBtn)) return;
    const inputPwd = await showPasswordPrompt("請輸入管理密碼進入系統設定：");
    if(inputPwd === null) return;
    try {
        const loginRes = await fetch(`${API_BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: inputPwd }) });
        const loginData = await loginRes.json();
        if (loginData.ok) {
            settingModal.classList.add('active');
            renderSettingLists();
        } else {
            alert("密碼錯誤");
        }
    } catch(e) { alert("驗證失敗：" + e.message); }
};
    }

    // 渲染房間、員工列表
    async function renderSettingLists() {
        const saveAnnouncementBtn = document.getElementById("saveAnnouncementBtn");
        const announcementInput = document.getElementById("announcementInput");

    // --- 房間列表 ---
    roomListWrap.innerHTML = "";
roomList.forEach((roomItem, idx) => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
            <span>全名：${roomItem.name}</span>
            <div style="display:flex;align-items:center;gap:6px;">
                <label style="font-size:13px;">縮寫：</label>
                <input class="short-input" data-idx="${idx}" value="${roomItem.short || ''}" style="padding:4px;flex:1;">
            </div>
        </div>
        <button data-type="room" data-idx="${idx}" class="delete-x-btn" title="刪除房間" style="align-self:flex-start;"><i class="fa-solid fa-xmark"></i></button>
    `;
    roomListWrap.appendChild(div);
});
// 綁定縮寫輸入框自動存儲
document.querySelectorAll('.short-input').forEach(input=>{
    input.onblur = async function(){
        const idx = Number(this.dataset.idx);
        const newShort = this.value.trim();
        roomList[idx].short = newShort;
        try {
            await fetch(`${API_BASE}/rooms/${roomList[idx].id}/short`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ short: newShort })
            });
        } catch(e) { console.error("縮寫更新失敗:", e); }
        updateView();
    }
})

    // --- 員工列表 ---
    empListWrap.innerHTML = "";
    empList.forEach((emp, idx) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <span>${emp.name}</span>
            <button data-type="emp" data-idx="${idx}" class="delete-x-btn" title="刪除員工"><i class="fa-solid fa-xmark"></i></button>
        `;
        empListWrap.appendChild(div);
    })

    // --- 綁定刪除按鈕 ---
    document.querySelectorAll('.list-item button').forEach(btn => {
        btn.onclick = async () => {
            if (!clickGuard(btn)) return;
            const type = btn.dataset.type;
            const i = Number(btn.dataset.idx);
            if(type === 'room'){
                 const roomItem = roomList[i];
                 const roomName = roomItem.name;
                 const used = eventsData.some(ev => ev.room === roomName);
                     if(used) return alert(`房間「${roomName}」尚有預約，無法刪除`);
                 try {
                     await fetch(`${API_BASE}/rooms/${roomItem.id}`, { method: "DELETE" });
                     alert(`房間「${roomName}」已移至回收站`);
                     await loadAllData();
                     renderSettingLists();
                 } catch(e) { alert("刪除失敗：" + e.message); }
            } else {
                const empItem = empList[i];
                try {
                    await fetch(`${API_BASE}/employees/${empItem.id}`, { method: "DELETE" });
                    await loadAllData();
                    renderSettingLists();
                } catch(e) { alert("刪除失敗：" + e.message); }
            }
        }
    })

    // --- 渲染回收站 ---
    const trashWrap = document.getElementById('trashRoomWrap');
    trashWrap.innerHTML = "";
    if(trashRoomList.length === 0){
        trashWrap.innerHTML = `<div style="color:#888;">回收站暫無刪除房間</div>`;
    }else{
        const clearAllBtnWrap = document.createElement('div');
        clearAllBtnWrap.style.marginBottom = "10px";
        clearAllBtnWrap.innerHTML = `<button id="clearAllTrashBtn" style="background:#c0392b;color:white;padding:4px 10px;">一鍵永久清空</button>`;
        trashWrap.appendChild(clearAllBtnWrap);

        trashRoomList.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <span>${item.name}</span>
                <div style="display:flex;gap:6px;">
                    <button data-type="restore" data-idx="${idx}" style="background:#27ae60;">恢復</button>
                    <button data-type="delForever" data-idx="${idx}" style="background:#c0392b;">永久刪除</button>
                </div>
            `;
            trashWrap.appendChild(div);
        })

        document.getElementById('clearAllTrashBtn').onclick = async function(){
            if (!clickGuard(this)) return;
            if(!confirm("確認永久清空回收站所有房間？此操作無法復原！")) return;
            try {
                await fetch(`${API_BASE}/rooms/trash/empty`, { method: "DELETE" });
                await loadAllData();
                renderSettingLists();
                alert("已永久清空回收站");
            } catch(e) { alert("操作失敗：" + e.message); }
        }
    }
    // 回收站按鈕綁定
    document.querySelectorAll('#trashRoomWrap .list-item button').forEach(btn => {
        btn.onclick = async () => {
            if (!clickGuard(btn)) return;
            const t = btn.dataset.type;
            const i = Number(btn.dataset.idx);
            const trashItem = trashRoomList[i];
            if(t === 'restore'){
                try {
                    await fetch(`${API_BASE}/rooms/${trashItem.id}/restore`, { method: "PUT" });
                    alert(`房間「${trashItem.name}」已恢復`);
                    await loadAllData();
                    renderSettingLists();
                } catch(e) { alert("恢復失敗：" + e.message); }
            } else {
                if(!confirm(`確定永久刪除「${trashItem.name}」？`)) return;
                try {
                    await fetch(`${API_BASE}/rooms/${trashItem.id}/permanent`, { method: "DELETE" });
                    await loadAllData();
                    renderSettingLists();
                } catch(e) { alert("刪除失敗：" + e.message); }
            }
        }
    })
    // 資訊小按鈕（僅限設定面板內的）
    document.querySelectorAll('#settingModal .info-btn').forEach(btn => {
        btn.onclick = () => alert(btn.dataset.tip);
    })

    // 公告欄：讀出後端公告並回填
    const annText = await getAnnouncement();
    announcementInput.value = annText;

    //公告欄儲存按鈕
    saveAnnouncementBtn.onclick = async () => {
        if (!clickGuard(saveAnnouncementBtn)) return;
        const txt = announcementInput.value;
        await saveAnnouncement(txt);
        alert("公告設定已儲存");
    };

    // 操作紀錄
    let logsOffset = 0;
    const logsPageSize = 30;
    const logsWrap = document.getElementById('logsWrap');
    const loadMoreLogsBtn = document.getElementById('loadMoreLogsBtn');
    async function loadLogs(reset=true){
        if(reset){ logsOffset=0; logsWrap.innerHTML=''; }
        try{
            const res = await fetch(`${API_BASE}/logs?limit=${logsPageSize}&offset=${logsOffset}`);
            const rows = await res.json();
            if(!rows.length && logsOffset===0){ logsWrap.innerHTML='<div style="color:#aaa;padding:8px;">暫無紀錄</div>'; loadMoreLogsBtn.style.display='none'; return; }
            rows.forEach(r=>{
                const d = document.createElement('div');
                d.style.cssText='padding:6px 0;border-bottom:1px solid #eee;';
                const time = r.created_at ? new Date(r.created_at).toLocaleString('zh-TW') : '';
                d.innerHTML = `<span style="color:#888;font-size:11px;">${time}</span> <b>${r.action||''}</b> <span style="color:#555;">${r.target_type||''} ${r.target_name||''}</span> <span style="color:#999;font-size:11px;">by ${r.operator||'系統'}</span>`;
                logsWrap.appendChild(d);
            });
            logsOffset += rows.length;
            loadMoreLogsBtn.style.display = rows.length >= logsPageSize ? '' : 'none';
        }catch(e){ logsWrap.innerHTML='<div style="color:red;">載入失敗</div>'; }
    }
    loadLogs();
    loadMoreLogsBtn.onclick = ()=> loadLogs(false);
    }

    // --- 新增房間 ---
    if(addRoomBtn){
    addRoomBtn.onclick = async () => {
    if (!clickGuard(addRoomBtn)) return;
    const val = newRoomInput.value.trim();
    if(!val) return alert("請輸入房間名稱");
    try {
        const color = generateRandomRoomColor();
        const res = await fetch(`${API_BASE}/rooms`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: val, short: '', colorData: JSON.stringify(color) })
        });
        const result = await res.json();
        if (!result.ok) return alert(result.msg);
        roomColorMap[val] = color;
        newRoomInput.value = "";
        await loadAllData();
        renderSettingLists();
        newRoomInput.focus();
    } catch(e) { alert("新增失敗：" + e.message); }
}
    }

    // --- 新增員工 ---
    if(addEmpBtn){
    addEmpBtn.onclick = async () => {
        if (!clickGuard(addEmpBtn)) return;
        const val = newEmpInput.value.trim();
        if(!val) return alert("請輸入員工姓名");
        try {
            const res = await fetch(`${API_BASE}/employees`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: val })
            });
            const result = await res.json();
            if (!result.ok) return alert(result.msg);
            newEmpInput.value = "";
            await loadAllData();
            renderSettingLists();
            newEmpInput.focus();
        } catch(e) { alert("新增失敗：" + e.message); }
    }
}

    // === Todos Button ===
    const todosBtn = document.getElementById('todosBtn');
    const todosModal = document.getElementById('todosModal');
    const addTodoBtn = document.getElementById('addTodoBtn');

    if (todosBtn) {
        todosBtn.onclick = async () => {
            if (!clickGuard(todosBtn)) return;
            populateTodoDropdowns();
            document.getElementById('todoStartDate').value = getTodayStr();
            document.getElementById('todoEndDate').value = getTodayStr();
            document.getElementById('todoStartDate').dataset.prev = getTodayStr();
            document.getElementById('todoTitle').value = '';
            document.getElementById('todoStartTime').value = '';
            document.getElementById('todoEndTime').value = '';
            document.getElementById('todoAllDay').checked = false;
            document.querySelectorAll('.todo-dow').forEach(cb => cb.checked = false);
        await loadTodos();
        await loadLeaves();
            renderTodos();
            await loadLeaves();
            if (window._renderLeaves) window._renderLeaves();
            if (window._populateLeaveEmployeeDropdown) window._populateLeaveEmployeeDropdown();
            document.getElementById('leaveStartDate').value = getTodayStr();
            document.getElementById('leaveEndDate').value = getTodayStr();
            document.getElementById('leaveStartDate').dataset.prev = getTodayStr();
            todosModal.classList.add('active');
        };
    }

    const todoStartDateEl = document.getElementById('todoStartDate');
    const todoEndDateEl = document.getElementById('todoEndDate');
    if (todoStartDateEl && todoEndDateEl) {
        todoStartDateEl.addEventListener('change', () => {
            const prev = todoStartDateEl.dataset.prev || '';
            const newStart = todoStartDateEl.value;
            if (!newStart) return;
            if (!todoEndDateEl.value || todoEndDateEl.value === prev) {
                todoEndDateEl.value = newStart;
            }
            todoStartDateEl.dataset.prev = newStart;
        });
    }

    const leaveStartDateEl = document.getElementById('leaveStartDate');
    const leaveEndDateEl = document.getElementById('leaveEndDate');
    if (leaveStartDateEl && leaveEndDateEl) {
        leaveStartDateEl.addEventListener('change', () => {
            const prev = leaveStartDateEl.dataset.prev || '';
            const newStart = leaveStartDateEl.value;
            if (!newStart) return;
            if (!leaveEndDateEl.value || leaveEndDateEl.value === prev) {
                leaveEndDateEl.value = newStart;
            }
            leaveStartDateEl.dataset.prev = newStart;
        });
    }

    // 選定開始時間後，結束時間自動設為一小時後
    const todoStartTimeEl = document.getElementById('todoStartTime');
    const todoEndTimeEl = document.getElementById('todoEndTime');
    if (todoStartTimeEl && todoEndTimeEl) {
        todoStartTimeEl.addEventListener('change', () => {
            const val = todoStartTimeEl.value;
            if (!val) return;
            const [h, m] = val.split(':').map(Number);
            const next = String((h + 1) % 24).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            if (Array.from(todoEndTimeEl.options).some(o => o.value === next)) {
                todoEndTimeEl.value = next;
            }
        });
    }

    if (addTodoBtn) {
        let todoBusy = false;
        addTodoBtn.onclick = async () => {
            if (todoBusy) return;
            const editId = addTodoBtn.dataset.editId;
            const title = document.getElementById('todoTitle').value.trim();
            const startDate = document.getElementById('todoStartDate').value;
            const endDate = document.getElementById('todoEndDate').value;
            const startTime = document.getElementById('todoStartTime').value;
            const endTime = document.getElementById('todoEndTime').value;
            const room = document.getElementById('todoRoom').value;
            const employee = document.getElementById('todoEmployee').value;
            const isAllDay = document.getElementById('todoAllDay').checked;
            const selectedDays = Array.from(document.querySelectorAll('.todo-dow:checked')).map(cb => parseInt(cb.value));
            if (!title || !startDate || !endDate) return alert('請填寫標題和日期');
            if (endDate < startDate) return alert('結束日期不能早於開始日期');
            if (!room || !employee) {
                const msg = !room && !employee ? '未指定房間及員工' : !room ? '未指定房間' : '未指定員工';
                if (!confirm(`${msg}，是否繼續？`)) return;
            }
            if (!isAllDay && selectedDays.length === 0) {
                if (!confirm('未指定全日及重複星期，將僅建立單一筆待辦事項，是否繼續？')) return;
            }

            todoBusy = true;
            addTodoBtn.disabled = true;
            const originalText = addTodoBtn.textContent;
            addTodoBtn.textContent = '新增中...';

            try {
                if (editId) {
                    // Edit mode — update single todo, changes detach it from its group
                    await fetch(`${API_BASE}/todos/${editId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, startDate, endDate, startTime, endTime, room, employee, isAllDay })
                    });
                    document.getElementById('todosModal').classList.remove("active");
                    delete addTodoBtn.dataset.editId;
                    addTodoBtn.textContent = originalText;
                } else {
                    // Add mode
                    const payloads = [];
                    if (selectedDays.length === 0) {
                        payloads.push({ title, startDate, endDate, startTime, endTime, room, employee, isAllDay });
                    } else {
                        const start = new Date(startDate + 'T00:00:00');
                        const end = new Date(endDate + 'T00:00:00');
                        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                            if (selectedDays.includes(d.getDay())) {
                                const dateStr = getFormattedDate(d);
                                payloads.push({ title, startDate: dateStr, endDate: dateStr, startTime, endTime, room, employee, isAllDay });
                            }
                        }
                        if (payloads.length === 0) { alert('日期範圍內沒有符合的星期幾'); return; }
                    }

                    // Send all in parallel to avoid blocking UI
                    await Promise.all(payloads.map(p =>
                        fetch(`${API_BASE}/todos`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(p)
                        })
                    ));

                    document.getElementById('todoTitle').value = '';
                    document.querySelectorAll('.todo-dow').forEach(cb => cb.checked = false);
                }

                await loadTodos();
                await loadLeaves();
                renderTodos();
                updateView();
            } catch (err) { alert('操作失敗：' + err.message); }
            finally {
                todoBusy = false;
                addTodoBtn.disabled = false;
                if (!addTodoBtn.dataset.editId) addTodoBtn.textContent = originalText;
            }
        };
    }

    // === 活動名稱搜尋統計（獨立於日曆渲染，避免污染既有渲染流程） ===
    const activitySearchInput = document.getElementById('activitySearchInput');
    const activitySearchBtn = document.getElementById('activitySearchBtn');
    const activitySearchKeyword = document.getElementById('activitySearchKeyword');
    const activitySearchRunBtn = document.getElementById('activitySearchRunBtn');
    const activitySearchModal = document.getElementById('activitySearchModal');
    const activitySearchRange = document.getElementById('activitySearchRange');

    const openActivitySearch = () => {
        if (activitySearchKeyword && activitySearchInput) {
            activitySearchKeyword.value = activitySearchInput.value;
        }
        if (activitySearchModal) activitySearchModal.classList.add('active');
        runActivitySearch();
    };

    if (activitySearchBtn) {
        activitySearchBtn.onclick = (e) => {
            e.preventDefault();
            openActivitySearch();
        };
    }
    if (activitySearchInput) {
        activitySearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                openActivitySearch();
            }
        });
    }
    if (activitySearchRunBtn) {
        activitySearchRunBtn.onclick = () => {
            if (activitySearchKeyword && activitySearchInput) {
                activitySearchInput.value = activitySearchKeyword.value;
            }
            runActivitySearch();
        };
    }
    if (activitySearchRange) {
        const activitySearchCustomRange = document.getElementById('activitySearchCustomRange');
        const toggleCustomRange = () => {
            if (!activitySearchCustomRange) return;
            activitySearchCustomRange.style.display = activitySearchRange.value === 'custom' ? 'flex' : 'none';
        };
        toggleCustomRange();
        activitySearchRange.onchange = () => {
            toggleCustomRange();
            runActivitySearch();
        };
    }
});

// ====== 活動名稱搜尋統計（純函數，完全不碰日曆渲染） ======
function normalizeSearchText(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

function getActivitySearchRangeBoundary(range) {
    const now = new Date();
    if (range === 'last12months') {
        const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start: getFormattedDate(start), end: getFormattedDate(end) };
    }
    if (range === 'thisYear') {
        return { start: now.getFullYear() + '-01-01', end: now.getFullYear() + '-12-31' };
    }
    if (range === 'custom') {
        const sEl = document.getElementById('activitySearchCustomStart');
        const eEl = document.getElementById('activitySearchCustomEnd');
        const start = (sEl && sEl.value) || '';
        const end = (eEl && eEl.value) || '';
        const invalid = !start || !end;
        let swapped = false;
        if (!invalid && start > end) { swapped = true; }
        return { start: start || null, end: end || null, invalid, swapped };
    }
    return { start: null, end: null };
}

function filterActivitiesByKeyword(keyword) {
    const kws = String(keyword || '').trim().split(/\s+/).filter(Boolean).map(normalizeSearchText);
    if (!kws.length) return [];
    const rangeEl = document.getElementById('activitySearchRange');
    const boundary = getActivitySearchRangeBoundary(rangeEl ? rangeEl.value : 'thisYear');
    if (boundary.invalid) return [];
    const { start, end } = boundary;
    return eventsData.filter(ev => {
        if (!ev || !ev.name) return false;
        if (start && (ev.date < start || ev.date > end)) return false;
        const hay = normalizeSearchText(ev.name);
        return kws.every(k => hay.includes(k));
    });
}

function groupActivitiesByTitle(list) {
    const groups = new Map();
    list.forEach(ev => {
        const name = String(ev.name || '').trim() || '(未命名)';
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(ev);
    });
    return Array.from(groups.entries())
        .map(([name, items]) => ({ name, items }))
        .sort((a, b) => b.items.length - a.items.length);
}

function getActivitySearchRangeLabel(range) {
    const map = { thisYear: '今年', last12months: '近12個月', all: '全部' };
    if (range === 'custom') {
        const sEl = document.getElementById('activitySearchCustomStart');
        const eEl = document.getElementById('activitySearchCustomEnd');
        const s = (sEl && sEl.value) || '未選';
        const e = (eEl && eEl.value) || '未選';
        return `自訂 ${s} ~ ${e}`;
    }
    return map[range] || '今年';
}

function renderActivitySearchGroups(groups) {
    const wrap = document.getElementById('activitySearchGroupsWrap');
    if (!wrap) return;
    if (!groups.length) {
        wrap.innerHTML = '<div class="act-search-empty">沒有符合的活動</div>';
        return;
    }
    const max = groups[0].items.length;
    const total = groups.reduce((acc, g) => acc + g.items.length, 0);
    const allRow = `<tr data-group="__ALL__" class="active-row"><td><span class="act-group-count">${total}</span></td><td>全部</td><td></td></tr>`;
    const rows = groups.map(g => {
        const pct = max ? Math.round((g.items.length / max) * 100) : 0;
        return `<tr data-group="${escapeHtml(g.name)}">
            <td><span class="act-group-count">${g.items.length}</span></td>
            <td>${escapeHtml(g.name)}</td>
            <td><div class="act-group-bar-wrap"><div class="act-group-bar"><span style="width:${pct}%"></span></div></div></td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `<table class="act-search-table"><thead><tr><th style="width:56px;">筆數</th><th>活動名稱</th><th style="width:120px;">佔比</th></tr></thead><tbody>${allRow}${rows}</tbody></table>`;

    wrap.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
            wrap.querySelectorAll('tbody tr').forEach(r => r.classList.remove('active-row'));
            tr.classList.add('active-row');
            const name = tr.dataset.group;
            const list = name === '__ALL__'
                ? groups.reduce((acc, g) => acc.concat(g.items), [])
                : (groups.find(g => g.name === name) || { items: [] }).items;
            renderActivitySearchDetails(list);
        });
    });
}

function renderActivitySearchDetails(list) {
    const wrap = document.getElementById('activitySearchDetailWrap');
    if (!wrap) return;
    if (!list.length) {
        wrap.innerHTML = '<div class="act-search-empty">沒有符合的活動</div>';
        return;
    }
    const rows = list.slice().sort((a, b) => (a.date + ' ' + a.startTime).localeCompare(b.date + ' ' + b.startTime)).map(ev => {
        const timeStr = (ev.startTime || ev.endTime) ? `${ev.startTime || ''}-${ev.endTime || ''}` : '';
        return `<tr data-date="${ev.date}">
            <td>${ev.date}</td>
            <td>${escapeHtml(ev.name)}</td>
            <td>${escapeHtml(ev.employee || '')}</td>
            <td>${escapeHtml(ev.room || '')}</td>
            <td>${timeStr}</td>
            <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(ev.note || '')}">${escapeHtml(ev.note || '')}</td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `<table class="act-search-table"><thead><tr><th>日期</th><th>活動名稱</th><th>員工</th><th>房間</th><th>時間</th><th>備註</th></tr></thead><tbody>${rows}</tbody></table>`;

    wrap.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const dateStr = tr.dataset.date;
            const modal = document.getElementById('activitySearchModal');
            if (modal) modal.classList.remove('active');
            const parts = String(dateStr).split('-').map(Number);
            selectedCalendarDate = new Date(parts[0], parts[1] - 1, parts[2]);
            updateView();
        });
    });
}

function runActivitySearch() {
    const keywordEl = document.getElementById('activitySearchKeyword');
    const rangeEl = document.getElementById('activitySearchRange');
    if (!keywordEl) return;
    const keyword = keywordEl.value;
    const range = rangeEl ? rangeEl.value : 'thisYear';

    const summaryEl = document.getElementById('activitySearchSummary');
    if (range === 'custom') {
        const boundary = getActivitySearchRangeBoundary('custom');
        if (boundary.invalid) {
            if (summaryEl) summaryEl.innerHTML = '請先選擇開始與結束日期再搜尋';
            renderActivitySearchGroups([]);
            renderActivitySearchDetails([]);
            return;
        }
        if (boundary.swapped && summaryEl) {
            summaryEl.innerHTML = `<div style="color:#c0392b;">結束日期不能早於開始日期</div>`;
            renderActivitySearchGroups([]);
            renderActivitySearchDetails([]);
            return;
        }
    }

    const list = filterActivitiesByKeyword(keyword);
    const groups = groupActivitiesByTitle(list);
    const allItems = groups.reduce((acc, g) => acc.concat(g.items), []);

    if (summaryEl) {
        if (!keyword.trim()) {
            summaryEl.innerHTML = '請輸入活動名稱關鍵字再搜尋';
        } else {
            summaryEl.innerHTML = `「<strong>${escapeHtml(keyword.trim())}</strong>」在 <strong>${getActivitySearchRangeLabel(range)}</strong> 共命中 <strong>${list.length}</strong> 筆預約、<strong>${groups.length}</strong> 種名稱組合`;
        }
    }

    renderActivitySearchGroups(keyword.trim() ? groups : []);
    renderActivitySearchDetails(keyword.trim() ? allItems : []);
}

// ====== HTML 跳脫（避免名稱內含特殊字元破壞結構） ======
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function populateTodoDropdowns() {
    const todoRoom = document.getElementById('todoRoom');
    const todoEmployee = document.getElementById('todoEmployee');
    if (!todoRoom || !todoEmployee) return;
    todoRoom.innerHTML = '<option value="">不指定</option>';
    todoEmployee.innerHTML = '<option value="">不指定</option>';
    if (Array.isArray(roomList)) roomList.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.name; opt.textContent = r.name;
        todoRoom.appendChild(opt);
    });
    if (Array.isArray(empList)) empList.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.name; opt.textContent = e.name;
        todoEmployee.appendChild(opt);
    });
}

// --- 視圖控制 ---
function updateView() {
    const view = viewSelect.value;
    // 同步：所有視圖都以「使用者選取的日期」為基準，避免切換視圖後錯位
    currentDate = new Date(selectedCalendarDate);
    const optDay = document.getElementById("optDayRange");
    if (view === "day") {
        optDay.style.display = "block";
        eventGrid.classList.remove("week-mode");
    } else {
        optDay.style.display = "none";
        if (view === "week") {
            eventGrid.classList.add("week-mode");
        } else {
            eventGrid.classList.remove("week-mode");
        }
    }

    monthView.style.display = (view === 'month') ? 'block' : 'none';
    timelineView.style.display = (view === 'month') ? 'none' : 'block';
    try {
        if (view === 'month') renderMonthView();
        else renderTimelineView(view);
    } catch(e) { console.error("renderView error:", e); }

    //切換視圖自動同步匯出下拉灰化
    syncExportRangeOptionState();
    syncMiniCalendar();
    renderRoomChips();
}

/**
 * 根據當前視圖，同步匯出下拉選單禁用/啟用狀態
 * Month視圖：可用【當前月份 / 全年】，禁用【當週、當日】
 * Week視圖：可用【當週 / 全年】，禁用【當前月份、當日】
 * Day視圖：可用【當日 / 全年】，禁用【當前月份、當週】
 */
function syncExportRangeOptionState() {
    const selectEl = document.getElementById("exportRange");
    if (!selectEl) return;
    const currentView = viewSelect.value;
    const options = Array.from(selectEl.options);

    // 先全部開啟
    options.forEach(opt => opt.disabled = false);

    if (currentView === "month") {
        // 月視圖 禁用：當週、當日
        options.find(o => o.value === "currentWeek").disabled = true;
        options.find(o => o.value === "currentDay").disabled = true;
        // 如果當前選中被禁用項目，強制切回合法選項
        if(["currentWeek","currentDay"].includes(selectEl.value)){
            selectEl.value = "currentMonth";
        }
    } else if (currentView === "week") {
        // 週視圖 禁用：當月、當日
        options.find(o => o.value === "currentMonth").disabled = true;
        options.find(o => o.value === "currentDay").disabled = true;
        if(["currentMonth","currentDay"].includes(selectEl.value)){
            selectEl.value = "currentWeek";
        }
    } else if (currentView === "day") {
        // 日視圖 禁用：當月、當週
        options.find(o => o.value === "currentMonth").disabled = true;
        options.find(o => o.value === "currentWeek").disabled = true;
        if(["currentMonth","currentWeek"].includes(selectEl.value)){
            selectEl.value = "currentDay";
        }
    }
}

async function changeDate(step) {
    const view = viewSelect.value;
    if (view === 'month') {
        currentDate.setMonth(currentDate.getMonth() + step);
        selectedCalendarDate = new Date(currentDate);
    } else if (view === 'week') {
        currentDate.setDate(currentDate.getDate() + (step * 7));
        selectedCalendarDate = new Date(currentDate);
    } else {
        // Day視圖：以滑鼠hover/點擊選取的日期前後翻頁
        selectedCalendarDate.setDate(selectedCalendarDate.getDate() + step);
        currentDate = new Date(selectedCalendarDate);
    }
    await loadHolidays(currentDate.getFullYear());
    updateView();
}

// --- 1. 大月曆（滑鼠hover預載日期、點擊永久鎖定）
function renderMonthView() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    monthYear.innerText = `${months[month]} ${year}`;
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const isMobile = isMobileMode();

    let html = '';
    for (let i = 0; i < firstDay; i++) html += '<div class="empty"></div>';

    for (let i = 1; i <= lastDate; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const isToday = dateStr === getTodayStr();
        const holiday = isHoliday(dateStr);
        const dayClasses = ['day' + (isToday ? ' today' : '') + (holiday ? ' holiday' : '')];

        let dayInner;
        if (holiday) {
            dayInner = `<span class="day-number holiday-number">${i}</span><span class="holiday-tag">${holiday.name}</span>`;
        } else {
            dayInner = `<span class="day-number">${i}</span>`;
        }

        html += `<div class="${dayClasses.join(' ')}" data-date="${dateStr}">${dayInner}`;

        const dots = [];

        // reservations
        eventsData.forEach((ev, index) => {
            const evEndDate = ev.endDate || ev.date;
            const isOnStartDate = ev.date === dateStr;
            const isOnEndDate = evEndDate === dateStr && evEndDate !== ev.date;
            if (!isOnStartDate && !isOnEndDate) return;
            if (filterEmployee && ev.employee !== filterEmployee) return;
            if (_isRoomFiltered(ev.room)) return;
            if (isMobile) {
                dots.push({ color: getRoomStyle(ev.room).label, title: ev.name });
                return;
            }
            const style = getRoomStyle(ev.room);
            const dispRoom = getCompactRoomText(ev.room);
            const prefix = isOnEndDate ? '[跨日] ' : '';
            html += `<div class="event-label" data-idx="${index}" style="background-color:${style.label};color:#fff;font-size:11px;line-height:1.3;padding:2px 4px;border-radius:3px;margin:1px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;box-sizing:border-box;cursor:pointer;"><strong>${ev.startTime}-${ev.endTime}</strong> ${prefix}${ev.name} · ${dispRoom}</div>`;
        });

        // todos
        todosData.forEach((todo) => {
            if (todo.startDate <= dateStr && todo.endDate >= dateStr) {
                if (filterEmployee && todo.employee !== filterEmployee) return;
                if (_isRoomFiltered(todo.room)) return;
                if (isMobile) {
                    dots.push({ color: '#f9a825', title: todo.title });
                    return;
                }
                let timeStr = todo.isAllDay ? '' : (todo.startTime || '');
                if (timeStr && todo.endTime) timeStr += '-' + todo.endTime;
                let dispRoom = todo.room ? getCompactRoomText(todo.room) : '';
                const empStr = todo.employee ? todo.employee : '';
                html += `<div class="event-label todo-label" data-todo-id="${todo.id}" style="background-color:#fff8e1;color:#5d4037;font-size:11px;line-height:1.3;padding:2px 4px;border-radius:3px;margin:1px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;box-sizing:border-box;cursor:pointer;border-left:3px solid #f9a825;"><span class="todo-marker"></span><strong>${timeStr}</strong> ${todo.title}` + (dispRoom ? ` · ${dispRoom}` : '') + (empStr ? ` (${empStr})` : '') + '</div>';
            }
        });

        // leaves
        const dayLeaves = getLeavesForDate(dateStr);
        dayLeaves.forEach(leave => {
            if (filterEmployee && leave.employee !== filterEmployee) return;
            if (isMobile) {
                dots.push({ color: '#4caf50', title: leave.employee + (leave.leaveType ? ' (' + leave.leaveType + ')' : '') });
                return;
            }
            const leaveTypeStr = leave.leaveType ? ` (${leave.leaveType})` : '';
            const isStart = leave.leaveDate === dateStr;
            const prefix = isStart ? '' : '[跨日] ';
            html += `<div class="event-label leave-label" data-leave-employee="${leave.employee}" data-leave-date="${leave.leaveDate}" style="background-color:#e8f5e9;color:#2e7d32;font-size:11px;line-height:1.3;padding:2px 4px;border-radius:3px;margin:1px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;box-sizing:border-box;cursor:pointer;border-left:3px solid #4caf50;"><span class="leave-square"></span>${prefix}${leave.employee}${leaveTypeStr}</div>`;
        });

        if (isMobile && dots.length) {
            const MAX_DOTS = 14;
            const shown = dots.slice(0, MAX_DOTS);
            const dotHtml = shown.map(d => `<span class="day-dot" style="background:${d.color};" title="${escapeHtml(d.title)}"></span>`).join('');
            const moreHtml = dots.length > MAX_DOTS ? `<span class="day-dot-more">+${dots.length - MAX_DOTS}</span>` : '';
            html += `<div class="day-dots">${dotHtml}${moreHtml}</div>`;
        }

        html += '</div>';
    }

    calendarDays.innerHTML = html;

    // attach click handlers via delegation
    calendarDays.querySelectorAll('.day').forEach(dayDiv => {
        const dateStr = dayDiv.dataset.date;
        dayDiv.onclick = () => {
            selectedDateStr = dateStr;
            selectedCalendarDate = new Date(dateStr);
            const pasteDateInput = document.getElementById('pasteDateInput');
            if (pasteDateInput && copiedEvent) pasteDateInput.value = dateStr;
            if (isMobileMode()) {
                viewSelect.value = 'day';
                updateView();
            } else {
                openBookingForm(dateStr);
            }
        };
    });
    calendarDays.querySelectorAll('.event-label:not(.todo-label):not(.leave-label)').forEach(evEl => {
        evEl.onclick = (e) => { e.stopPropagation(); showEventDetails(parseInt(evEl.dataset.idx)); };
    });
    calendarDays.querySelectorAll('.todo-label').forEach(evEl => {
        evEl.onclick = (e) => {
            e.stopPropagation();
            const todo = todosData.find(t => t.id === parseInt(evEl.dataset.todoId));
            if (todo) showTodoDetail(todo);
        };
    });
    calendarDays.querySelectorAll('.leave-label').forEach(evEl => {
        evEl.onclick = (e) => {
            e.stopPropagation();
            const emp = evEl.dataset.leaveEmployee;
            const ldate = evEl.dataset.leaveDate;
            const leave = leavesData.find(l => l.employee === emp && l.leaveDate === ldate);
            if (leave) showLeaveDetail(leave);
        };
    });

}

// --- 2. 時間軸（Day視圖永遠渲染滑鼠hover/點擊選取的日期）
function renderTimelineView(type) {
    const weekHeader = document.getElementById('weekHeader');
    eventGrid.innerHTML = "";
    timeColumn.innerHTML = "";
    eventGrid.className = "event-grid";
eventGrid.classList.remove("week-mode");

    const allDayGutter = document.createElement('div');
    allDayGutter.className = 'time-gutter-allDay';
    allDayGutter.textContent = '全天';
    timeColumn.appendChild(allDayGutter);

    for (let h = 0; h <= 23; h++) {
        timeColumn.innerHTML += `<div class="time-slot-label">${String(h).padStart(2,'0')}:00</div>`;
    }



    if (type === 'day') {
        weekHeader.style.display = 'none';
        monthYear.innerText = formatDateFull(selectedCalendarDate);
        eventGrid.appendChild(createDayColumn(getFormattedDate(selectedCalendarDate)));
    }else {
        weekHeader.style.display = 'grid';
        eventGrid.classList.add('week-mode');
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        monthYear.innerText = `${months[startOfWeek.getMonth()].substring(0,3)} ${startOfWeek.getDate()} – ${months[endOfWeek.getMonth()].substring(0,3)} ${endOfWeek.getDate()}, ${endOfWeek.getFullYear()}`;

        const headerLabels = weekHeader.querySelectorAll('.week-col-label');
        for (let i = 0; i < 7; i++) {
            const targetDate = new Date(startOfWeek);
            targetDate.setDate(startOfWeek.getDate() + i);
            headerLabels[i].innerText = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i]} ${targetDate.getDate()}`;
            eventGrid.appendChild(createDayColumn(getFormattedDate(targetDate)));
        }
    }

}

function createDayColumn(dateStr) {
    const col = document.createElement('div');
    col.className = 'day-column';
    const allDay = document.createElement('div');
    allDay.className = 'day-column-allDay';
    allDay.innerHTML = getDayExtrasHtml(dateStr);
    col.appendChild(allDay);
    const body = document.createElement('div');
    body.className = 'day-column-body';
    col.appendChild(body);
    renderEventsIntoColumn(body, dateStr);
    return col;
}

function getDayExtrasHtml(dateStr) {
    const dayTodos = (todosData || []).filter(todo => {
        if (filterEmployee && todo.employee !== filterEmployee) return false;
        if (_isRoomFiltered(todo.room)) return false;
        return todo.startDate <= dateStr && todo.endDate >= dateStr;
    });
    const dayLeaves = getLeavesForDate ? getLeavesForDate(dateStr).filter(l => {
        if (filterEmployee && l.employee !== filterEmployee) return false;
        return true;
    }) : [];
    if (dayTodos.length === 0 && dayLeaves.length === 0) return '';
    let html = '';
    dayTodos.forEach(todo => {
        const timeStr = todo.isAllDay ? '全天' : (todo.startTime || '');
        html += '<div class="event-label todo-label" style="background-color:#fff8e1;color:#5d4037;font-size:11px;line-height:1.3;padding:2px 4px;border-radius:3px;margin:1px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;box-sizing:border-box;cursor:pointer;border-left:3px solid #f9a825;"><span class="todo-marker"></span> ' + timeStr + ' ' + todo.title + (todo.employee ? ' (' + todo.employee + ')' : '') + '</div>';
    });
    dayLeaves.forEach(leave => {
        const prefix = leave.leaveDate === dateStr ? '' : '[跨日] ';
        const leaveTypeStr = leave.leaveType ? ' (' + leave.leaveType + ')' : '';
        html += '<div class="event-label leave-label" style="background-color:#e8f5e9;color:#2e7d32;font-size:11px;line-height:1.3;padding:2px 4px;border-radius:3px;margin:1px 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;box-sizing:border-box;cursor:pointer;border-left:3px solid #4caf50;"><span class="leave-square"></span> ' + prefix + leave.employee + leaveTypeStr + '</div>';
    });
    return html;
}

function renderEventsIntoColumn(columnElement, dateStr) {
    const startHour = 0;
    const dayEvents = eventsData.filter(ev => {
        const isOnStart = ev.date === dateStr;
        const isOnEnd = ev.endDate && ev.endDate === dateStr && ev.endDate !== ev.date;
        if (!isOnStart && !isOnEnd) return false;
        if (filterEmployee && ev.employee !== filterEmployee) return false;
        if (_isRoomFiltered(ev.room)) return false;
        return true;
    });
    const timeGroup = {};
    // 按開始時間分組（跨日結束日歸到 00:00 組）
    dayEvents.forEach(ev => {
        const isOnEnd = ev.endDate && ev.endDate === dateStr && ev.endDate !== ev.date;
        const groupKey = isOnEnd ? '00:00' : ev.startTime;
        if (!timeGroup[groupKey]) timeGroup[groupKey] = [];
        timeGroup[groupKey].push(ev);
    });

    Object.values(timeGroup).forEach(group => {
        const total = group.length;
        const THRESHOLD = 3; // 閾值：超過3條就垂直堆疊
        const MAX_HORIZONTAL = 5; // 水平模式最多顯示5條，超出顯示+按鈕
        const MAX_VERTICAL_SHOW = 4; // 垂直模式最多顯示4條
        const itemHeight = 34; // 垂直模式單條高度

        if (total <= THRESHOLD) {
            // ========== 模式1：≤3條 → 水平橫向排布（原有邏輯） ==========
            const visibleList = group.slice(0, MAX_HORIZONTAL);
            const hiddenCount = total - MAX_HORIZONTAL;
            const perWidthPct = 100 / visibleList.length;

            visibleList.forEach((ev, idx) => {
                let displayStart = ev.startTime;
                let displayEnd = ev.endTime;
                const isOnEnd = ev.endDate && ev.endDate === dateStr && ev.endDate !== ev.date;
                const isOnStart = ev.date === dateStr;
                if (isOnEnd) {
                    displayStart = '00:00';
                }
                if (isOnStart && ev.endDate && ev.endDate !== ev.date) {
                    displayEnd = '24:00';
                }
                const [sH, sM] = displayStart.split(':').map(Number);
                const top = ((sH - startHour) * 60) + sM;
                let height = ((displayEnd.split(':').map(Number)[0] - sH) * 60) + (displayEnd.split(':').map(Number)[1] - sM);
                if (height < 20) height = 20;

                const roomStyle = getRoomStyle(ev.room);
                const dispRoom = getRoomDisplayText(ev.room);
                const evEl = document.createElement("div");
                evEl.className = "booked-slot";

                evEl.style.cssText = `
                    position: absolute;
                    top: ${top}px;
                    left: calc(2px + ${idx * perWidthPct}%);
                    width: calc(${perWidthPct}% - 4px);
                    min-width:32px;
                    height: ${height}px;
                    background-color: ${roomStyle.bg};
                    border-left: 5px solid ${roomStyle.border};
                    color: #2c3e50;
                    padding: 3px;
                    font-size: 10px;
                    line-height: 1.25;
                    border-radius: 3px;
                    overflow: hidden;
                    z-index: 10;
                    white-space:nowrap;
                    text-overflow:ellipsis;
                `;
                evEl.innerHTML = `<strong>${ev.startTime}</strong> ${ev.name}｜${dispRoom}`;
                evEl.onclick = (e) => {
                    e.stopPropagation();
                    const targetIndex = eventsData.findIndex(item => item === ev);
                    showEventDetails(targetIndex);
                };
                columnElement.appendChild(evEl);
            });

            // 水平模式聚合 +N 按鈕
            if (hiddenCount > 0) {
                const baseEv = group[0];
                const [sH, sM] = baseEv.startTime.split(':').map(Number);
                const top = ((sH - startHour) * 60) + sM;
                const perWidthPct = 100 / visibleList.length;

                const moreBtn = document.createElement("div");
                moreBtn.className = "booked-slot";
                moreBtn.style.cssText = `
                    position: absolute;
                    top: ${top}px;
                    left: calc(2px + ${visibleList.length * perWidthPct}%);
                    width: calc(${perWidthPct}% - 4px);
                    min-width:32px;
                    height: 32px;
                    background:#dddddd;
                    border-radius:3px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    font-size:11px;
                    cursor:pointer;
                    z-index:10;
                `;
                moreBtn.textContent = `+${hiddenCount}`;
                moreBtn.onclick = (e) => {
                    e.stopPropagation();
                    let text = `同時間全部預約（共${total}條）：\n`;
                    group.forEach(item => {
                        text += `${item.startTime} ${item.name}｜${item.room}\n`;
                    });
                    alert(text);
                };
                columnElement.appendChild(moreBtn);
            }
        } else {
            // ========== 模式2：>3條 → 垂直堆疊排布 ==========
            const visibleList = group.slice(0, MAX_VERTICAL_SHOW);
            const hiddenCount = total - MAX_VERTICAL_SHOW;

            visibleList.forEach((ev, idx) => {
                const isOnEnd = ev.endDate && ev.endDate === dateStr && ev.endDate !== ev.date;
                const displayStart = isOnEnd ? '00:00' : ev.startTime;
                const [sH, sM] = displayStart.split(':').map(Number);
                const baseTop = ((sH - startHour) * 60) + sM;
                const blockTop = baseTop + idx * itemHeight;

                const roomStyle = getRoomStyle(ev.room);
                const dispRoom = getRoomDisplayText(ev.room);
                const evEl = document.createElement("div");
                evEl.className = "booked-slot";

                evEl.style.cssText = `
                    position: absolute;
                    top: ${blockTop}px;
                    left: 4px;
                    width: calc(100% - 8px);
                    height: ${itemHeight - 4}px;
                    background-color: ${roomStyle.bg};
                    border-left: 5px solid ${roomStyle.border};
                    color: #2c3e50;
                    padding: 3px 6px;
                    font-size: 10px;
                    line-height: 1.25;
                    border-radius: 3px;
                    overflow: hidden;
                    z-index: 10;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                `;
                evEl.innerHTML = `<strong>${displayStart}</strong> ${ev.name}｜${dispRoom}`;
                evEl.onclick = (e) => {
                    e.stopPropagation();
                    const targetIndex = eventsData.findIndex(item => item === ev);
                    showEventDetails(targetIndex);
                };
                columnElement.appendChild(evEl);
            });

            // 垂直模式聚合 +N 按鈕
            if (hiddenCount > 0) {
                const baseEv = group[0];
                const isEnd = baseEv.endDate && baseEv.endDate === dateStr && baseEv.endDate !== baseEv.date;
                const baseStart = isEnd ? '00:00' : baseEv.startTime;
                const [sH, sM] = baseStart.split(':').map(Number);
                const baseTop = ((sH - startHour) * 60) + sM;
                const moreTop = baseTop + MAX_VERTICAL_SHOW * itemHeight;

                const moreBtn = document.createElement("div");
                moreBtn.className = "booked-slot";
                moreBtn.style.cssText = `
                    position: absolute;
                    top: ${moreTop}px;
                    left:4px;
                    width:calc(100% - 8px);
                    height: ${itemHeight - 4}px;
                    background:#dddddd;
                    border-radius:3px;
                    display:flex;
                    align-items:center;
                    padding-left:12px;
                    font-size:11px;
                    cursor:pointer;
                    z-index:10;
                `;
                moreBtn.textContent = `+${hiddenCount} 更多預約，點擊查看全部`;
                moreBtn.onclick = (e) => {
                    e.stopPropagation();
                    let text = `同時間全部預約（共${total}條）：\n`;
                    group.forEach(item => {
                        text += `${item.startTime} ${item.name}｜${item.room}\n`;
                    });
                    alert(text);
                };
                columnElement.appendChild(moreBtn);
            }
        }
    });
}

// --- 3. 彈窗詳情邏輯
function showEventDetails(index) {
    currentViewIndex = index;
    const ev = eventsData[index];
    const style = getRoomStyle(ev.room);
    document.getElementById('viewEventTitle').innerText = ev.name;
    document.getElementById('viewEventDate').innerText = formatDateFull(new Date(ev.date));
    const evEnd = ev.endDate || ev.date;
    if (evEnd !== ev.date) {
        document.getElementById('viewEventTime').innerText = `${ev.startTime} (${ev.date}) → ${ev.endTime} (${evEnd})`;
    } else {
        document.getElementById('viewEventTime').innerText = `${ev.startTime} - ${ev.endTime}`;
    }
    document.getElementById('viewEventRoom').innerText = ev.room;
    document.querySelector('#viewEventEmployee span').innerText = ev.employee;
    document.getElementById('detailBar').style.backgroundColor = style.border;
    const noteWrap = document.getElementById('viewEventNoteWrap');
    if (noteWrap) noteWrap.style.display = ev.note ? 'block' : 'none';
    viewDetailModal.classList.add('active');
}

function openBookingForm(dateStr, index = -1) {
    // 設定 select 數值；若選項不存在（例如非 30 分鐘刻度的時間），自動加入暫存選項再選取
    function setSelectValue(el, value) {
        if (!el || !value) return;
        if (!Array.from(el.options).some(o => o.value === value)) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value;
            el.appendChild(opt);
        }
        el.value = value;
    }
    selectedDateStr = dateStr;
    currentViewIndex = index;
    const formTitle = document.getElementById('formTitle');
    const roomSelect = document.getElementById('roomSelect');
    roomSelect.innerHTML = "";

    // 動態渲染房間下拉選項
    roomList.forEach(roomItem => {
        const opt = document.createElement('option');
        opt.value = roomItem.name;
        opt.textContent = roomItem.name;
        roomSelect.appendChild(opt);
    });
    // 其他自訂房間選項
    const optOther = document.createElement('option');
    optOther.value = "_custom_other";
    optOther.textContent = "其他";
    roomSelect.appendChild(optOther);

    // 自訂房間輸入框控制
    let customRoomInput = document.querySelector('#customRoomInput');
    if (!customRoomInput) {
        customRoomInput = document.createElement('input');
        customRoomInput.type = 'text';
        customRoomInput.id = 'customRoomInput';
        customRoomInput.placeholder = '輸入自訂房間名稱';
        customRoomInput.style.display = 'none';
        customRoomInput.style.marginTop = '6px';
        customRoomInput.style.padding = '8px';
        customRoomInput.style.width = '100%';
        roomSelect.after(customRoomInput);
    }
    customRoomInput.style.display = "none";
    customRoomInput.value = "";

    // 下拉切換事件
    roomSelect.onchange = () => {
        if(roomSelect.value === "_custom_other"){
            customRoomInput.style.display = "block";
        }else{
            customRoomInput.style.display = "none";
        }
    }

    // ====== 員工下拉部分 ======
    const empSelect = document.getElementById('employeeName');
    empSelect.innerHTML = "";
    empList.forEach(emp => {
        const opt = document.createElement('option');
        opt.value = emp.name;
        opt.innerText = emp.name;
        empSelect.appendChild(opt);
    })
    const empOtherOpt = document.createElement('option');
    empOtherOpt.value = "_custom_emp";
    empOtherOpt.innerText = "其他";
    empSelect.appendChild(empOtherOpt);

    const customEmpInput = document.getElementById("customEmpInput");
    if(customEmpInput){
        customEmpInput.style.display = "none";
        customEmpInput.value = "";
    }

    empSelect.onchange = () => {
        if(!customEmpInput) return;
        if(empSelect.value === "_custom_emp"){
            customEmpInput.style.display = "block";
        }else{
            customEmpInput.style.display = "none";
        }
    };

    // ====== 編輯模式回填 ======
    const startTimeEl = document.getElementById("startTime");
    const endTimeEl = document.getElementById("endTime");
    document.querySelectorAll('.time-slot-btn').forEach(btn => {
        btn.onclick = () => {
            const slot = btn.dataset.slot;
            const map = { all: ['09:00','18:00'], am: ['09:00','13:00'], pm: ['14:00','18:00'] };
            const [s, e] = map[slot] || [];
            if (s) { startTimeEl.value = s; endTimeEl.value = e; }
        };
    });
    startTimeEl.onchange = () => {
        const [sh, sm] = startTimeEl.value.split(':').map(Number);
        let eh = sh + 1;
        if(eh > 23) eh = 23;
        const nextEnd = `${String(eh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
        const endOpts = Array.from(endTimeEl.options).map(o => o.value);
        if(endOpts.includes(nextEnd)){
            endTimeEl.value = nextEnd;
        }else{
            endTimeEl.value = "23:30";
        }
    };

    if (index === -1) {
        const isPaste = pasteRequested && copiedEvent;
        formTitle.innerText = isPaste ? `新增預約（已貼上）(${dateStr})` : `新增預約 (${dateStr})`;
        document.getElementById("eventTitle").value = isPaste ? copiedEvent.name : "";
        document.getElementById("eventNote").value = isPaste ? (copiedEvent.note || '') : "";

        if (isPaste) {
            // 貼上：活動名/時間/房間/負責人沿用複製內容，僅日期改變
            setSelectValue(document.getElementById("startTime"), copiedEvent.startTime);
            setSelectValue(document.getElementById("endTime"), copiedEvent.endTime);

            const empMatch = empList.some(emp => emp.name === copiedEvent.employee);
            if (empMatch) {
                empSelect.value = copiedEvent.employee;
            } else if (copiedEvent.employee) {
                empSelect.value = "_custom_emp";
                const cEmp = document.getElementById("customEmpInput");
                if (cEmp) { cEmp.value = copiedEvent.employee; cEmp.style.display = "block"; }
            } else if (empList.length > 0) {
                empSelect.value = empList[0].name;
            }

            const roomMatch = roomList.some(r => r.name === copiedEvent.room);
            if (roomMatch) {
                roomSelect.value = copiedEvent.room;
            } else if (copiedEvent.room) {
                roomSelect.value = "_custom_other";
                customRoomInput.style.display = "block";
                customRoomInput.value = copiedEvent.room;
            } else if (roomList.length > 0) {
                roomSelect.value = roomList[0].name;
            }
            pasteRequested = false;
        } else {
            if(empList.length > 0){
                document.getElementById("employeeName").value = empList[0].name;
            }
            // 新建預約預設第一個房間
            if(roomList.length > 0){
                roomSelect.value = roomList[0].name;
            }
        }
    } else {
        const ev = eventsData[index];
        formTitle.innerText = `編輯預約 (${dateStr})`;
        document.getElementById("eventTitle").value = ev.name;
        document.getElementById("employeeName").value = ev.employee;
        setSelectValue(document.getElementById("startTime"), ev.startTime);
        setSelectValue(document.getElementById("endTime"), ev.endTime);
        document.getElementById("eventNote").value = ev.note || '';

        // 回填房間下拉
        const optMatch = Array.from(roomSelect.options).find(o => o.value === ev.room);
        if (optMatch) {
            roomSelect.value = ev.room;
        } else {
            // 不在列表內，切換其他並顯示輸入框
            roomSelect.value = "_custom_other";
            customRoomInput.style.display = "block";
            customRoomInput.value = ev.room;
        }
    }
    modalForm.classList.add("active");
}

// 通用雙擊防護：以元素為 key，1.5 秒內不重複觸發
const _clickGuardSet = new WeakSet();
function clickGuard(el) {
    if (_clickGuardSet.has(el)) return false;
    _clickGuardSet.add(el);
    setTimeout(() => _clickGuardSet.delete(el), 1500);
    return true;
}
const _clickGuardMap = new Map();
function clickGuardKey(key) {
    const now = Date.now();
    if (_clickGuardMap.has(key) && now - _clickGuardMap.get(key) < 1500) return false;
    _clickGuardMap.set(key, now);
    return true;
}

// 載入中轉圈
let _loadingTimer = 0;
function showLoading() {
    clearTimeout(_loadingTimer);
    const el = document.getElementById('loadingSpinner');
    if (el) el.style.display = 'flex';
}
function hideLoading() {
    clearTimeout(_loadingTimer);
    const el = document.getElementById('loadingSpinner');
    if (el) el.style.display = 'none';
}

//確認預約按鈕
let isSubmitting = false;
const recentSubmissions = new Map();
function isDuplicateSubmission(key) {
    const now = Date.now();
    if (recentSubmissions.has(key) && now - recentSubmissions.get(key) < 5000) return true;
    recentSubmissions.set(key, now);
    return false;
}
if(bookBtn){
bookBtn.onclick = async (e) => {
    if(e) e.preventDefault();
    if(e) e.stopPropagation();
    if (isSubmitting) return;
    console.log("[BOOK] clicked, selectedDateStr=", selectedDateStr, "currentViewIndex=", currentViewIndex);
    // 1. 全部取值並強制清除首尾空白
    const rawName = document.getElementById("eventTitle").value;
    const startTimeRaw = document.getElementById("startTime").value;
    const endTimeRaw = document.getElementById("endTime").value;
    let employeeRaw = document.getElementById("employeeName").value;
    let roomRaw = document.getElementById('roomSelect').value;
    const customRoomInput = document.getElementById("customRoomInput");
    const customEmpInput = document.getElementById("customEmpInput");
    console.log("[BOOK] raw values:", {rawName, startTimeRaw, endTimeRaw, employeeRaw, roomRaw});

    // 處理自訂員工
    if(employeeRaw === "_custom_emp"){
        employeeRaw = customEmpInput.value.trim();
        if(!employeeRaw) return alert("請填寫自訂員工名稱");
    }
    // 處理自訂房間
    if(roomRaw === "_custom_other"){
        roomRaw = customRoomInput.value.trim();
        if(!roomRaw) return alert("請填寫自訂房間名稱");
    }

    // 2. 強制清洗所有字串，只保留安全字元（過濾換行、特殊符號、全形空格）
    const cleanStr = (s) => s.replace(/\s+/g, " ").trim();
    const cleanTime = (s) => s.replace(/[^0-9:]/g, "").trim();

    const name = cleanStr(rawName);
    const employee = cleanStr(employeeRaw);
    const room = cleanStr(roomRaw);
    const startTime = cleanTime(startTimeRaw);
    const endTime = cleanTime(endTimeRaw);
    const date = cleanStr(selectedDateStr);
    const note = document.getElementById("eventNote").value.trim();
    console.log("[BOOK] cleaned:", {name, employee, room, startTime, endTime, date});

    // 3. 基礎空值攔截
    if (!name || !employee || !room) { console.log("[BOOK] BLOCKED: empty fields"); return alert("活動名稱、員工、房間不能空白"); }
    // 強制時間格式 HH:MM 長度檢查
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        console.log("[BOOK] BLOCKED: bad time format");
        return alert("時間格式必須為 00:00，不能包含其他文字");
    }
    // 強制日期格式 YYYY-MM-DD 檢查
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.log("[BOOK] BLOCKED: bad date format");
        return alert("日期格式非法");
    }

    // 跨日預約：結束時間早於開始時間 → 隔日結束
    let endDate = date;
    if (startTime >= endTime) {
        const nextDay = new Date(date + 'T00:00:00');
        nextDay.setDate(nextDay.getDate() + 1);
        endDate = getFormattedDate(nextDay);
    }

    // 4. 組裝完全乾淨、符合後端規範的物件
    const newEv = {
        date: date,
        endDate: endDate,
        name: name,
        employee: employee,
        room: room,
        startTime: startTime,
        endTime: endTime,
        note: note
    };
    console.log("[BOOK] payload:", JSON.stringify(newEv));

    // 過去日期確認（若仍報錯可直接註釋這整段測試）
    const todayStr = getTodayStr();
    if(date < todayStr){
        const confirmPast = confirm("預約日期在今日之前，確認儲存？");
        if(!confirmPast) return;
    }

    // 前端時段衝突檢查（支援跨日）
    const isConflict = eventsData.some((ev, idx) => {
        if (idx === currentViewIndex || ev.room !== room) return false;
        const evEnd = ev.endDate || ev.date;
        const newStartDT = date + 'T' + startTime;
        const newEndDT = endDate + 'T' + endTime;
        const evStartDT = ev.date + 'T' + ev.startTime;
        const evEndDT = evEnd + 'T' + ev.endTime;
        return newStartDT < evEndDT && newEndDT > evStartDT;
    });
    if (isConflict) { console.log("[BOOK] BLOCKED: conflict"); return alert("該時段房間已有預約"); }

    // 前端去重：5秒內相同日期+房間+時間的預約擋下
    const dedupKey = `${date}|${room}|${startTime}|${endTime}`;
    if (isDuplicateSubmission(dedupKey)) { console.log("[BOOK] BLOCKED: duplicate"); return alert("請勿重複提交"); }

    console.log("[BOOK] calling API...");
    isSubmitting = true;
    bookBtn.disabled = true;
    try{
        let saved;
        if (currentViewIndex >= 0 && eventsData[currentViewIndex] && eventsData[currentViewIndex].id) {
            const evId = eventsData[currentViewIndex].id;
            console.log("[BOOK] PUT edit id=", evId);
            saved = await updateReservation(evId, newEv);
            eventsData[currentViewIndex] = saved;
        } else {
            console.log("[BOOK] POST new");
            saved = await createReservation(newEv);
            eventsData.push(saved);
        }
        console.log("[BOOK] success, closing modal");
        modalForm.classList.remove("active");
        updateView();
    }catch(err){
        console.error("[BOOK] API error:", err);
        alert("儲存失敗：" + err.message);
    }finally{
        isSubmitting = false;
        bookBtn.disabled = false;
    }
};
}
// --- 工具函數 ---
function getTodayStr() { return getFormattedDate(new Date()); }
function getFormattedDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function formatDateFull(d) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

// 取得當前顯示年月
function getCurrentViewYM(){
    const titleText = monthYear.innerText;
    const arr = titleText.split(" ");
    const monthName = arr[0];
    const year = parseInt(arr[1]);
    const monthMap = {
        "January":0,"February":1,"March":2,"April":3,"May":4,"June":5,
        "July":6,"August":7,"September":8,"October":9,"November":10,"December":11
    }
    const month = monthMap[monthName];
    return {year,month};
}

// 過濾預約數據：當月 / 全年（含員工/房間篩選）
function getFilterEvents(range){
    const {year,month} = getCurrentViewYM();
    let list = [];
    const inRange = (dateStr) => {
        if (range === "currentMonth") {
            const y = parseInt(dateStr.split("-")[0]);
            const m = parseInt(dateStr.split("-")[1]) - 1;
            return y === year && m === month;
        } else if (range === "currentDay") {
            return dateStr === getFormattedDate(selectedCalendarDate);
        } else if (range === "currentWeek") {
            const startOfWeek = new Date(currentDate);
            startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            const d = new Date(dateStr);
            return d >= startOfWeek && d <= endOfWeek;
        }
        return true; // allYear
    };
    eventsData.forEach(ev => { if (inRange(ev.date)) list.push(ev); });
    if (todosData) todosData.forEach(todo => {
        if (inRange(todo.startDate)) list.push({ ...todo, _type: 'todo', name: todo.title, date: todo.startDate, startTime: todo.startTime || '', endTime: todo.endTime || '' });
    });
    if (typeof leavesData !== 'undefined') leavesData.forEach(leave => {
        if (inRange(leave.leaveDate)) list.push({ ...leave, _type: 'leave', name: leave.employee + ' 休假' + (leave.leaveType ? '(' + leave.leaveType + ')' : ''), employee: leave.employee, date: leave.leaveDate, startTime: '', endTime: '' });
    });
    // 套用員工/房間篩選
    if (filterEmployee) list = list.filter(ev => ev.employee === filterEmployee);
    if (filterRooms.length) list = list.filter(ev => filterRooms.includes(ev.room));
    list.sort((a,b)=>{
        const d1 = a.date + " " + a.startTime;
        const d2 = b.date + " " + b.startTime;
        return d1 > d2 ? 1 : -1;
    })
    return list;
}

// 匯出 Excel
function exportExcel(range){
    const data = getFilterEvents(range);
    const {year,month} = getCurrentViewYM();
    const monthStr = String(month + 1).padStart(2,"0");
    let fileName;
    if(range === "currentMonth"){
        fileName = `預約_${monthStr}/${year}.xlsx`;
    }else if(range === "currentDay"){
        const dayStr = getFormattedDate(selectedCalendarDate);
        fileName = `預約_當日${dayStr}.xlsx`;
    }else if(range === "currentWeek"){
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const s = getFormattedDate(startOfWeek);
        const e = getFormattedDate(endOfWeek);
        fileName = `預約_週${s}至${e}.xlsx`;
    }else{
        fileName = `預約_${year}.xlsx`;
    }

    const book = XLSX.utils.book_new();

    // Sheet 1: 預約（僅預約，不含待辦事項與員工假期；結束日期由系統依時間自動判斷）
    const resData = [["日期","活動名稱","預約員工","房間","開始時間","結束時間","備註"]];
    data.forEach(ev=>{
        if (ev._type) return;
        resData.push([ev.date, ev.name, ev.employee, ev.room, ev.startTime, ev.endTime, ev.note || ''])
    })
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(resData), "預約");

    // Sheet 2: 待辦事項
    const todoData = [["標題","開始日期","結束日期","開始時間","結束時間","房間","負責人","全日"]];
    const filteredTodos = getFilteredTodos(range);
    filteredTodos.forEach(t=>{
        todoData.push([t.title, t.startDate, t.endDate, t.startTime||'', t.endTime||'', t.room||'', t.employee||'', t.isAllDay ? '是' : ''])
    })
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(todoData), "待辦事項");

    // Sheet 3: 公眾假期
    const holidayData = [["日期","名稱","英文名稱"]];
    const filteredHolidays = getFilteredHolidays(range);
    filteredHolidays.forEach(h=>{
        holidayData.push([h.date, h.name, h.name_en||''])
    })
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(holidayData), "公眾假期");

    // Sheet 4: 員工假期
    const leaveData = [["員工姓名","開始日期","結束日期","假期類型"]];
    const filteredLeaves = getFilteredLeaves(range);
    filteredLeaves.forEach(l=>{
        leaveData.push([l.employee, l.leaveDate, l.endDate || l.leaveDate, l.leaveType||''])
    })
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(leaveData), "員工假期");

    XLSX.writeFile(book, fileName);
}

function getFilteredTodos(range){
    const {year,month} = getCurrentViewYM();
    let list = [...todosData];
    if(range === "currentMonth"){
        list = list.filter(t => {
            const ty = parseInt(t.startDate.split("-")[0]);
            const tm = parseInt(t.startDate.split("-")[1]) - 1;
            return ty === year && tm === month;
        });
    }else if(range === "currentDay"){
        const d = getFormattedDate(selectedCalendarDate);
        list = list.filter(t => t.startDate <= d && t.endDate >= d);
    }else if(range === "currentWeek"){
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const ws = getFormattedDate(startOfWeek);
        const we = getFormattedDate(endOfWeek);
        list = list.filter(t => t.startDate <= we && t.endDate >= ws);
    }
    if(filterEmployee) list = list.filter(t => t.employee === filterEmployee);
    if(filterRooms.length) list = list.filter(t => filterRooms.includes(t.room));
    return list;
}

function getFilteredHolidays(range){
    const {year,month} = getCurrentViewYM();
    let list = [...holidaysData];
    if(range === "currentMonth"){
        list = list.filter(h => {
            const hy = parseInt(h.date.split("-")[0]);
            const hm = parseInt(h.date.split("-")[1]) - 1;
            return hy === year && hm === month;
        });
    }else if(range === "currentDay"){
        const d = getFormattedDate(selectedCalendarDate);
        list = list.filter(h => h.date === d);
    }else if(range === "currentWeek"){
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const ws = getFormattedDate(startOfWeek);
        const we = getFormattedDate(endOfWeek);
        list = list.filter(h => h.date >= ws && h.date <= we);
    }
    return list;
}

function getFilteredLeaves(range){
    const {year,month} = getCurrentViewYM();
    let list = [...leavesData];
    if(range === "currentMonth"){
        list = list.filter(l => {
            const ly = parseInt(l.leaveDate.split("-")[0]);
            const lm = parseInt(l.leaveDate.split("-")[1]) - 1;
            const endD = l.endDate || l.leaveDate;
            const ey = parseInt(endD.split("-")[0]);
            const em = parseInt(endD.split("-")[1]) - 1;
            return (ly === year && lm === month) || (ey === year && em === month) || (ly < year || (ly === year && lm < month)) && (ey > year || (ey === year && em > month));
        });
    }else if(range === "currentDay"){
        const d = getFormattedDate(selectedCalendarDate);
        list = list.filter(l => l.leaveDate <= d && (l.endDate || l.leaveDate) >= d);
    }else if(range === "currentWeek"){
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const ws = getFormattedDate(startOfWeek);
        const we = getFormattedDate(endOfWeek);
        list = list.filter(l => l.leaveDate <= we && (l.endDate || l.leaveDate) >= ws);
    }
    if(filterEmployee) list = list.filter(l => l.employee === filterEmployee);
    return list;
}

// 依可用寬度將文字換行（保留空白字元，完整換行不截斷）
function pdfWrapText(doc, text, maxW) {
    const lines = [];
    let cur = '';
    for (const ch of String(text)) {
        if (doc.getTextWidth(cur + ch) > maxW && cur) {
            lines.push(cur);
            cur = ch;
        } else {
            cur += ch;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

let cachedSimHeiB64 = null;
async function loadSimHeiFont() {
    if (cachedSimHeiB64) return cachedSimHeiB64;
    const res = await fetch('fonts/SimHei.ttf');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
    cachedSimHeiB64 = b64;
    return b64;
}

async function applySimHeiFont(doc) {
    const b64 = await loadSimHeiFont();
    doc.addFileToVFS('SimHei.ttf', b64);
    doc.addFont('SimHei.ttf', 'SimHei', 'normal');
    doc.addFont('SimHei.ttf', 'SimHei', 'bold');
    doc.setFont('SimHei', 'normal');
}

// 匯出 PDF
async function exportPdf(range){
    const data = getFilterEvents(range);
    if(data.length === 0 && range !== 'currentWeek') return alert("該範圍無任何記錄");
    const {year,month} = getCurrentViewYM();
    const monthStr = String(month + 1).padStart(2,"0");
    let fileName;
    if(range === "currentMonth"){
        fileName = `月曆預約_${monthStr}/${year}.pdf`;
    }else if(range === "currentDay"){
        const dayStr = getFormattedDate(selectedCalendarDate);
        fileName = `月曆預約_當日${dayStr}.pdf`;
    }else if(range === "currentWeek"){
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const s = getFormattedDate(startOfWeek);
        const e = getFormattedDate(endOfWeek);
        fileName = `月曆預約_週${s}至${e}.pdf`;
    }else{
        fileName = `月曆預約_${year}.pdf`;
    }

    const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
    if(!JsPDF){ alert("jsPDF 未載入，無法匯出 PDF"); return; }

    if(range === "allYear"){
        const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        try {
            await applySimHeiFont(doc);
        } catch (err) {
            alert("中文字型載入失敗：" + err.message);
            return;
        }
        const targetYear = year;
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const monthsEN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const colW = pageW / 7;
        const headerH = 8;
        const titleH = 10;
        const margin = 4;
        const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const itemFont = 7;
        const lineH = 3.6;
        const availH = pageH - margin * 2 - titleH - headerH;

        // 每個日期格：與月曆 UI 一致的涵蓋判定（跨日/區間都算），換行後全數列出
        function drawDayContent(day, x, y, cellW) {
            const font = day._font;
            const lh = day._lh;
            doc.setFontSize(8);
            doc.setFont(undefined, 'bold');
            if(day.dateStr === getTodayStr()) doc.setTextColor(74, 144, 226);
            else doc.setTextColor(51);
            doc.text(String(day.dayNum), x + 2, y + 3.5);
            let ey = y + 7;
            doc.setFont(undefined, 'normal');
            day.items.forEach(it => {
                if (it.kind === 'holiday') {
                    doc.setTextColor(211, 47, 47);
                    doc.setFont(undefined, 'bold');
                    doc.setFontSize(Math.min(font, 6));
                    let t = it.text;
                    if (doc.getTextWidth(t) > cellW) {
                        while (doc.getTextWidth(t + '…') > cellW && t.length > 1) t = t.slice(0, -1);
                        t += '…';
                    }
                    doc.text(t, x + 1, ey);
                    ey += lh;
                    doc.setTextColor(51);
                    doc.setFont(undefined, 'normal');
                    doc.setFontSize(font);
                    return;
                }
                let fill, textColor;
                if (it.kind === 'leave') { fill = [76, 175, 80]; textColor = [255, 255, 255]; }
                else if (it.kind === 'todo') { fill = [249, 168, 37]; textColor = [93, 64, 55]; }
                else {
                    const hex = getRoomStyle(it.room).label || '#7c5cbf';
                    fill = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
                    textColor = [255, 255, 255];
                }
                doc.setFontSize(font);
                doc.setFont(undefined, 'bold');
                const lines = pdfWrapText(doc, it.text, cellW - 1);
                doc.setFillColor(fill[0], fill[1], fill[2]);
                doc.rect(x + 0.5, ey - 2, cellW, lines.length * lh, 'F');
                doc.setTextColor(textColor[0], textColor[1], textColor[2]);
                lines.forEach((ln, li) => doc.text(ln, x + 1, ey + li * lh));
                ey += lines.length * lh;
                doc.setTextColor(51);
                doc.setFont(undefined, 'normal');
            });
        }

        for(let m = 0; m < 12; m++){
            if(m > 0) doc.addPage();
            const firstDay = new Date(targetYear, m, 1).getDay();
            const lastDate = new Date(targetYear, m + 1, 0).getDate();
            const totalCells = firstDay + lastDate;
            const rows = Math.ceil(totalCells / 7);
            const cellWAvailable = colW - 2;

            const days = [];
            for(let i = 0; i < totalCells; i++){
                const dayNum = i - firstDay + 1;
                const dateStr = `${targetYear}-${String(m+1).padStart(2,'0')}-${String(Math.max(dayNum, 1)).padStart(2,'0')}`;
                const items = [];
                if(dayNum >= 1){
                    const holiday = isHoliday(dateStr);
                    if(holiday) items.push({ kind: 'holiday', text: holiday.name });
                    (eventsData || []).forEach(ev => {
                        if (ev.date !== dateStr) return;
                        if (filterEmployee && ev.employee !== filterEmployee) return;
                        if (_isRoomFiltered(ev.room)) return;
                        items.push({ kind: 'event', text: `${ev.startTime} ${ev.name} - ${ev.room}`, room: ev.room });
                    });
                    (todosData || []).forEach(todo => {
                        if (filterEmployee && todo.employee !== filterEmployee) return;
                        if (_isRoomFiltered(todo.room)) return;
                        if (todo.startDate <= dateStr && todo.endDate >= dateStr) {
                            items.push({ kind: 'todo', text: (todo.startTime || '') + ' ' + todo.title });
                        }
                    });
                    (leavesData || []).forEach(leave => {
                        if (filterEmployee && leave.employee !== filterEmployee) return;
                        if (leave.leaveDate <= dateStr && (leave.endDate || leave.leaveDate) >= dateStr) {
                            items.push({ kind: 'leave', text: leave.employee + ' 休假' + (leave.leaveType ? '(' + leave.leaveType + ')' : '') });
                        }
                    });
                }
                days.push({ dayNum, dateStr, items });
            }

            // 計算每個日期格需要的行數；超過一頁可容納時改用緊湊字級，確保不截斷
            doc.setFont('SimHei', 'normal');
            doc.setFontSize(itemFont);
            days.forEach(day => {
                let lines = 1;
                day.items.forEach(it => {
                    if(it.kind === 'holiday'){ lines += 1; return; }
                    lines += pdfWrapText(doc, it.text, cellWAvailable).length;
                });
                let font = itemFont, lh = lineH;
                if (lines * lh + 2 > availH) {
                    doc.setFontSize(5);
                    let compact = 1;
                    day.items.forEach(it => {
                        if(it.kind === 'holiday'){ compact += 1; return; }
                        compact += pdfWrapText(doc, it.text, cellWAvailable).length;
                    });
                    doc.setFontSize(itemFont);
                    font = 5; lh = 2.8;
                    lines = compact;
                    if (lines * lh + 2 > availH) lines = Math.max(1, Math.floor((availH - 2) / lh));
                }
                day._font = font;
                day._lh = lh;
                day._lines = lines;
                day._need = Math.min(availH, lines * lh + 2);
            });

            // 每列高度依當列最滿的一天決定；放不下就分頁，確保不截斷
            const rowInfos = [];
            for(let r = 0; r < rows; r++){
                const slice = days.slice(r * 7, r * 7 + 7);
                let h = 10;
                slice.forEach(d => { h = Math.max(h, d._need); });
                rowInfos.push({ days: slice, h });
            }

            const pageRows = [];
            let cur = [];
            let used = 0;
            rowInfos.forEach((ri, idx) => {
                if(used + ri.h > availH && cur.length > 0){
                    pageRows.push(cur);
                    cur = [];
                    used = 0;
                }
                cur.push(idx);
                used += ri.h;
            });
            if(cur.length > 0) pageRows.push(cur);

            pageRows.forEach((rowIndexes, pi) => {
                if(pi > 0) doc.addPage();
                doc.setFontSize(16);
                doc.setTextColor(51);
                doc.text(`${monthsEN[m]} ${targetYear}`, pageW / 2, margin + 7, { align: 'center' });
                doc.setDrawColor(74, 144, 226);
                doc.setLineWidth(0.5);
                doc.line(margin, margin + titleH - 2, pageW - margin, margin + titleH - 2);

                const topY = margin + titleH;
                doc.setFontSize(9);
                doc.setFont(undefined, 'bold');
                doc.setFillColor(238, 238, 238);
                doc.rect(margin, topY, pageW - margin * 2, headerH, 'F');
                doc.setTextColor(80);
                weekdays.forEach((w, wi) => {
                    doc.text(w, margin + wi * colW + colW / 2, topY + headerH - 2, { align: 'center' });
                });

                const gridTop = topY + headerH;
                doc.setFont(undefined, 'normal');
                let y = gridTop;
                rowIndexes.forEach(riIdx => {
                    const ri = rowInfos[riIdx];
                    ri.days.forEach((day, ci) => {
                        const x = margin + ci * colW;
                        doc.setDrawColor(215, 207, 207);
                        doc.setLineWidth(0.2);
                        doc.rect(x, y, colW, ri.h);
                        if(day.dayNum >= 1) drawDayContent(day, x, y, cellWAvailable);
                    });
                    y += ri.h;
                });
            });
        }
        doc.save(fileName);
        return;
    }

    if(range === "currentWeek"){
        const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        try {
            await applySimHeiFont(doc);
        } catch (err) {
            alert("中文字型載入失敗：" + err.message);
            return;
        }
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const dayLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const weekDates = [];
        for(let i = 0; i < 7; i++){
            const d = new Date(startOfWeek);
            d.setDate(startOfWeek.getDate() + i);
            weekDates.push(getFormattedDate(d));
        }

        const margin = 5;
        const titleH = 10;
        const dayHeaderH = 9;
        const timeColW = 16;
        const dayColW = (pageW - margin * 2 - timeColW) / 7;
        const hoursPerPage = 12;

        // 全日帶（待辦/假期）－與月曆 UI 一致：以「涵蓋該日」判定（跨日/區間都算），全部顯示不截斷
        const allDayItemsByDay = weekDates.map(dateStr => {
            const items = [];
            (todosData || []).forEach(todo => {
                if (filterEmployee && todo.employee !== filterEmployee) return;
                if (_isRoomFiltered(todo.room)) return;
                if (todo.startDate <= dateStr && todo.endDate >= dateStr) {
                    items.push({ _type: 'todo', name: todo.title, startTime: todo.startTime || '' });
                }
            });
            (leavesData || []).forEach(leave => {
                if (filterEmployee && leave.employee !== filterEmployee) return;
                if (leave.leaveDate <= dateStr && (leave.endDate || leave.leaveDate) >= dateStr) {
                    items.push({ _type: 'leave', name: leave.employee + ' 休假' + (leave.leaveType ? '(' + leave.leaveType + ')' : ''), startTime: '' });
                }
            });
            return items;
        });
        const hasEvents = data.some(ev => !ev._type);
        if (!hasEvents && allDayItemsByDay.every(items => items.length === 0)) return alert("該範圍無任何記錄");
        const allDayRowH = 3.4;
        doc.setFontSize(6);
        doc.setFont(undefined, 'bold');
        const allDayLineCountByDay = allDayItemsByDay.map(items => {
            let total = 0;
            items.forEach(item => {
                const label = (item._type === 'todo' ? (item.startTime || '') + ' ' : '') + item.name;
                total += pdfWrapText(doc, label, dayColW - 4).length;
            });
            return total;
        });
        const maxAllDayLineCount = Math.max(0, ...allDayLineCountByDay);
        const allDayBandH = maxAllDayLineCount * allDayRowH;
        const allDayTopY = margin + titleH + dayHeaderH;

        const gridTopY = allDayTopY + allDayBandH;
        const gridH = pageH - gridTopY - margin;
        const hourH = gridH / hoursPerPage;
        const totalPages = Math.ceil(24 / hoursPerPage);

        for(let pg = 0; pg < totalPages; pg++){
            if(pg > 0) doc.addPage();
            const startHour = pg * hoursPerPage;
            const endHour = Math.min(startHour + hoursPerPage, 24);

            doc.setFontSize(14);
            doc.setTextColor(51);
            doc.text(`Week: ${weekDates[0]} - ${weekDates[6]}`, pageW / 2, margin + 7, { align: 'center' });
            doc.setDrawColor(74, 144, 226);
            doc.setLineWidth(0.5);
            doc.line(margin, margin + titleH - 2, pageW - margin, margin + titleH - 2);

            const dayHeaderY = margin + titleH;
            doc.setFillColor(238, 238, 238);
            doc.rect(margin, dayHeaderY, pageW - margin * 2, dayHeaderH, 'F');
            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(80);
            dayLabels.forEach((label, i) => {
                const x = margin + timeColW + i * dayColW;
                const dateObj = new Date(weekDates[i]);
                const text = `${label} ${dateObj.getDate()}`;
                doc.text(text, x + dayColW / 2, dayHeaderY + dayHeaderH - 2.5, { align: 'center' });
            });

            doc.setFont(undefined, 'normal');
            for(let h = startHour; h < endHour; h++){
                const y = gridTopY + (h - startHour) * hourH;
                doc.setDrawColor(200, 200, 200);
                doc.setLineWidth(0.2);
                doc.line(margin + timeColW, y, pageW - margin, y);

                doc.setFontSize(8);
                doc.setTextColor(100);
                doc.text(`${String(h).padStart(2,'0')}:00`, margin + 2, y + 4);

                for(let di = 0; di < 7; di++){
                    const cx = margin + timeColW + di * dayColW;
                    doc.setDrawColor(230, 230, 230);
                    doc.setLineWidth(0.1);
                    doc.line(cx, y, cx, y + hourH);
                }
            }
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.2);
            doc.line(margin + timeColW, gridTopY + (endHour - startHour) * hourH, pageW - margin, gridTopY + (endHour - startHour) * hourH);

            data.forEach(ev => {
                if (ev._type || !ev.startTime || !ev.endTime || !ev.date) return;
                const evDateIdx = weekDates.indexOf(ev.date);
                if(evDateIdx < 0) return;
                const [sh, sm] = ev.startTime.split(':').map(Number);
                const [eh, em] = ev.endTime.split(':').map(Number);
                const evStartMin = sh * 60 + sm;
                const evEndMin = eh * 60 + em;
                const pageStartMin = startHour * 60;
                const pageEndMin = endHour * 60;
                if(evEndMin <= pageStartMin || evStartMin >= pageEndMin) return;

                const visStart = Math.max(evStartMin, pageStartMin);
                const visEnd = Math.min(evEndMin, pageEndMin);
                const topY = gridTopY + ((visStart - pageStartMin) / 60) * hourH;
                const botY = gridTopY + ((visEnd - pageStartMin) / 60) * hourH;
                const barH = Math.max(botY - topY, 3);

                const roomStyle = getRoomStyle(ev.room);
                const hex = roomStyle.label || '#7c5cbf';
                const r = parseInt(hex.slice(1,3),16);
                const g = parseInt(hex.slice(3,5),16);
                const b = parseInt(hex.slice(5,7),16);
                doc.setFillColor(r, g, b);
                const bx = margin + timeColW + evDateIdx * dayColW + 1;
                const bw = dayColW - 2;
                doc.rect(bx, topY, bw, barH, 'F');

                doc.setTextColor(255, 255, 255);
                doc.setFontSize(7);
                doc.setFont(undefined, 'bold');
                const txt = `${ev.startTime} ${ev.name}`;
                if(barH >= 5){
                    doc.text(txt, bx + 1.5, topY + 3.5);
                    doc.setFont(undefined, 'normal');
                    doc.setFontSize(6);
                    doc.text(ev.room, bx + 1.5, topY + 7);
                }else{
                    doc.text(txt, bx + 1.5, topY + barH - 1.2);
                }
                doc.setTextColor(51);
            });

            // Draw all-day todos/leaves (only on first page) inside the reserved band
            if (startHour === 0 && allDayBandH > 0) {
                weekDates.forEach((dateStr, di) => {
                    const items = allDayItemsByDay[di];
                    if (items.length === 0) return;

                    const bx = margin + timeColW + di * dayColW + 1;
                    const bw = dayColW - 2;
                    let y = allDayTopY;
                    items.forEach(item => {
                        const isTodo = item._type === 'todo';
                        doc.setFillColor(isTodo ? 255 : 76, isTodo ? 248 : 175, isTodo ? 225 : 80);
                        doc.setTextColor(isTodo ? 93 : 255, isTodo ? 64 : 255, isTodo ? 55 : 255);
                        doc.setFontSize(6);
                        doc.setFont(undefined, 'bold');
                        const label = isTodo ? (item.startTime || '') + ' ' + item.name : item.name;
                        const lines = pdfWrapText(doc, label, bw - 2);
                        const cellH = lines.length * allDayRowH;
                        doc.rect(bx, y, bw, cellH, 'F');
                        lines.forEach((ln, li) => doc.text(ln, bx + 1, y + allDayRowH - 1 + li * allDayRowH));
                        y += cellH;
                    });
                });
            }
        }
        doc.save(fileName);
        return;
    }

    // currentMonth / currentDay: 使用 html2pdf 截圖
    const printDom = document.getElementById("mainViewContainer");
    const opt = {
        margin: 10,
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS:true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    const monthGrid = document.getElementById("monthView");
    const daysWrap = document.getElementById("day");
    const oldGridHeight = monthGrid.style.height;
    const oldDayHeight = daysWrap.style.gridAutoRows;
    monthGrid.style.height = "auto";
    daysWrap.style.gridAutoRows = "auto";

    const timelineEl = document.getElementById("timelineView");
    const oldTimelineMaxH = timelineEl.style.maxHeight;
    const oldTimelineOverflow = timelineEl.style.overflowY;
    timelineEl.style.maxHeight = "none";
    timelineEl.style.overflowY = "visible";

    // Expand all-day strips to show all todos/leaves
    const allDayStrips = document.querySelectorAll('.day-column-allDay');
    const oldAllDayStyles = Array.from(allDayStrips).map(el => ({
        el,
        height: el.style.height,
        overflow: el.style.overflowY,
        maxHeight: el.style.maxHeight
    }));
    allDayStrips.forEach(el => {
        el.style.height = 'auto';
        el.style.overflowY = 'visible';
        el.style.maxHeight = 'none';
    });

    // 同步時間欄「全天」槽位高度＝最高全天條高度，避免小時標籤與網格錯位
    const timeGutters = document.querySelectorAll('.time-gutter-allDay');
    const oldGutterStyles = Array.from(timeGutters).map(el => ({ el, height: el.style.height }));
    let maxAllDayH = 0;
    allDayStrips.forEach(el => { maxAllDayH = Math.max(maxAllDayH, el.offsetHeight || 0); });
    if (maxAllDayH > 0) {
        allDayStrips.forEach(el => { el.style.height = maxAllDayH + 'px'; });
        timeGutters.forEach(el => { el.style.height = maxAllDayH + 'px'; });
    }

    setTimeout(()=>{
        html2pdf().set(opt).from(printDom).save().finally(()=>{
            monthGrid.style.height = oldGridHeight;
            daysWrap.style.gridAutoRows = oldDayHeight;
            timelineEl.style.maxHeight = oldTimelineMaxH;
            timelineEl.style.overflowY = oldTimelineOverflow;
            oldAllDayStyles.forEach(({el, height, overflow, maxHeight}) => {
                el.style.height = height;
                el.style.overflowY = overflow;
                el.style.maxHeight = maxHeight;
            });
            oldGutterStyles.forEach(({el, height}) => { el.style.height = height; });
        });
    }, 300);
}

/// ========== 匯入 Excel 工具函數（全域，放DOMContentLoaded外面） ==========
// Excel時間小數轉 HH:MM
function excelTimeToStr(timeVal) {
    if (typeof timeVal === 'number') {
        // 只取小數部分（時間），忽略整數部分（日期）
        const frac = timeVal - Math.floor(timeVal);
        const totalMin = Math.round(frac * 24 * 60);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    // 文字格式
    let str = String(timeVal).trim();
    if (!str.includes(':')) {
        return str.padStart(2,'0') + ':00';
    }
    const [h, m] = str.split(':');
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// Excel日期轉 YYYY-MM-DD（兼容序列號、M/D/YY文字）
function excelDateToStr(dateVal) {
    if (typeof dateVal === 'number') {
        // Excel日期序列號
        const dateObj = new Date((dateVal - 25569) * 86400 * 1000);
        return getFormattedDate(dateObj);
    }
    let str = String(dateVal).trim();
    if (str.includes('/')) {
        // 7/15/26 = 月/日/年
        const parts = str.split('/');
        let m = parts[0];
        let d = parts[1];
        let y = parts[2];
        if (y.length === 2) y = '20' + y;
        return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    return str;
}

// 舊格式日期（含星期，如「1/03/2025（Fri）」）轉 YYYY-MM-DD；用星期自動驗證 月/日 順序
function legacyDateToStr(dateVal) {
    if (typeof dateVal === 'number') return excelDateToStr(dateVal);
    let str = String(dateVal).trim();
    if (!str) return null;
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) return str.slice(0, 10);
    const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
    const statedDow = extractWeekdayIndex(str);
    const primary = buildDateStr(y, a, b);
    if (primary) {
        if (statedDow === null || getWeekdayIndex(primary) === statedDow) return primary;
        const swapped = buildDateStr(y, b, a);
        if (swapped && getWeekdayIndex(swapped) === statedDow) return swapped;
        return primary;
    }
    const swapped = buildDateStr(y, b, a);
    return swapped || null;
}

function buildDateStr(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function getWeekdayIndex(dateStr) {
    return new Date(dateStr + 'T00:00:00').getDay();
}

function extractWeekdayIndex(str) {
    const s = String(str).toLowerCase();
    const names = ['sun','mon','tue','wed','thu','fri','sat'];
    for (let i = 0; i < names.length; i++) {
        if (s.includes(names[i])) return i;
    }
    if (s.includes('星期日') || s.includes('星期天') || s.includes('週日') || s.includes('周日')) return 0;
    if (s.includes('星期一') || s.includes('週一') || s.includes('周一')) return 1;
    if (s.includes('星期二') || s.includes('週二') || s.includes('周二')) return 2;
    if (s.includes('星期三') || s.includes('週三') || s.includes('周三')) return 3;
    if (s.includes('星期四') || s.includes('週四') || s.includes('周四')) return 4;
    if (s.includes('星期五') || s.includes('週五') || s.includes('周五')) return 5;
    if (s.includes('星期六') || s.includes('週六') || s.includes('周六')) return 6;
    return null;
}

// 舊格式時段（全日/am/pm）轉開始/結束時間
function sessionToTimes(sessionVal) {
    const v = String(sessionVal || '').trim().toLowerCase();
    if (v === '全日' || v === '全天' || v === 'full' || v === 'allday' || v === 'all day') return { sTime: '09:00', eTime: '18:00' };
    if (v === 'am' || v === '上午' || v === '早上' || v === 'morning') return { sTime: '09:00', eTime: '13:00' };
    if (v === 'pm' || v === '下午' || v === 'afternoon') return { sTime: '14:00', eTime: '18:00' };
    return null;
}

// 取得日曆顯示用房間文字：有縮寫顯示縮寫，否則全名；不在roomList內一律全名
function getRoomDisplayText(roomName){
    const found = roomList.find(r => r.name === roomName);
    if(found && found.short && found.short.trim() !== ""){
        return found.short.trim();
    }
    return roomName;
}

// 月視圖專用：優先取簡稱，否則自動縮寫（如 Classroom 1 → C1）
function getCompactRoomText(roomName){
    const found = roomList.find(r => r.name === roomName);
    if (found && found.short && found.short.trim() !== '') return found.short.trim();
    const words = roomName.split(/\s+/).filter(Boolean);
    if (words.length === 1 && words[0].length <= 5) return words[0];
    return words.map(w => /^[A-Z]+$/.test(w) ? w : w.charAt(0).toUpperCase()).join('');
}

// ====== 左側邊欄：房間色塊（多選） ======
function renderRoomChips() {
    const wrap = document.getElementById('roomChips');
    if (!wrap) return;
    const allRooms = [...roomList];
    let html = `<button class="room-chip${filterRooms.length === 0 ? ' active' : ''}" data-room="" style="border-left:3px solid #ccc;"><span class="chip-dot" style="background:#ccc;"></span>全部</button>`;
    allRooms.forEach(r => {
        const style = getRoomStyle(r.name);
        const active = filterRooms.includes(r.name) ? ' active' : '';
        html += `<button class="room-chip${active}" data-room="${r.name.replace(/"/g, '&quot;')}" style="border-left:3px solid ${style.border};background:${style.bg}20;">
            <span class="chip-dot" style="background:${style.border};"></span>${r.name}</button>`;
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.room-chip').forEach(el => {
        el.onclick = () => {
            const room = el.dataset.room || '';
            if (room === '') {
                filterRooms = [];
            } else if (filterRooms.includes(room)) {
                filterRooms = filterRooms.filter(v => v !== room);
            } else {
                filterRooms.push(room);
            }
            renderRoomChips();
            _refreshRoomMultiFilter();
            updateView();
        };
    });
    // 色塊點擊：開啟房間顏色選擇器（不觸發篩選）
    wrap.querySelectorAll('.chip-dot').forEach(dot => {
        dot.onclick = (e) => {
            e.stopPropagation();
            const room = dot.closest('.room-chip').dataset.room;
            if (room) showColorPicker(room);
        };
    });
}

// ====== 房間顏色選擇器（HSV 調色盤） ======
function _hsvToRgb(h, s, v) {
    s /= 100; v /= 100;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r, g, b;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255)
    ];
}
function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
function _hexToHsv(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = max === 0 ? 0 : (d / max) * 100, v = max * 100;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
    }
    return [h, s, v];
}

let _pickerDragging = null;
function showColorPicker(roomName) {
    selectedColorRoom = roomName;
    const modal = document.getElementById('colorPickerModal');
    const title = document.getElementById('colorPickerTitle');
    const gradEl = document.getElementById('pickerGradient');
    const hueEl = document.getElementById('pickerHue');
    const marker = document.getElementById('pickerMarker');
    const hueMarker = document.getElementById('pickerHueMarker');
    const previewCur = document.getElementById('pickerPreviewCur');
    const previewNew = document.getElementById('pickerPreviewNew');
    const hexInput = document.getElementById('pickerHexInput');
    const swatchesEl = document.getElementById('colorSwatches');

    title.textContent = `調整「${roomName}」顏色`;

    const currentHex = getRoomStyle(roomName).border;
    previewCur.style.background = currentHex;
    let [curH, curS, curV] = _hexToHsv(currentHex);

    function applyToUI() {
        const [r, g, b] = _hsvToRgb(curH, curS, curV);
        const hex = _rgbToHex(r, g, b);
        gradEl.style.background = `hsl(${curH}, 100%, 50%)`;
        previewNew.style.background = hex;
        hexInput.value = hex.replace('#', '').toUpperCase();
        marker.style.left = (curS) + '%';
        marker.style.top = (100 - curV) + '%';
        hueMarker.style.left = (curH / 360 * 100) + '%';
        swatchesEl.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.toggle('selected', s.dataset.color.toLowerCase() === hex.toLowerCase());
        });
    }

    gradEl.onmousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        _pickSV(e, gradEl, (x, y) => { curS = x * 100; curV = (1 - y) * 100; applyToUI(); });
    };
    hueEl.onmousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        _pickHue(e, hueEl, (pct) => { curH = pct * 360; applyToUI(); });
    };

    swatchesEl.innerHTML = ROOM_PALETTE.map(hex =>
        `<div class="color-swatch${hex.toLowerCase() === currentHex.toLowerCase() ? ' selected' : ''}" data-color="${hex}" style="background:${hex};"></div>`
    ).join('');
    swatchesEl.querySelectorAll('.color-swatch').forEach(el => {
        el.onclick = () => {
            [curH, curS, curV] = _hexToHsv(el.dataset.color);
            applyToUI();
        };
    });

    hexInput.value = currentHex.replace('#', '').toUpperCase();
    hexInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            const v = hexInput.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
            if (v.length === 6) {
                [curH, curS, curV] = _hexToHsv('#' + v);
                applyToUI();
            }
        }
    };
    hexInput.onblur = () => {
        const v = hexInput.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
        if (v.length === 6) {
            [curH, curS, curV] = _hexToHsv('#' + v);
            applyToUI();
        }
    };

    applyToUI();
    modal.classList.add('active');
}

function _pickSV(e, el, onChange) {
    const rect = el.getBoundingClientRect();
    function move(ev) {
        const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
        const x = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (cy - rect.top) / rect.height));
        onChange(x, y);
    }
    move(e);
    function onMove(ev) { ev.preventDefault(); move(ev); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}
function _pickHue(e, el, onChange) {
    const rect = el.getBoundingClientRect();
    function move(ev) {
        const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const x = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
        onChange(x);
    }
    move(e);
    function onMove(ev) { ev.preventDefault(); move(ev); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

const colorPickerConfirm = document.getElementById('colorPickerConfirm');
if (colorPickerConfirm) {
    colorPickerConfirm.onclick = async () => {
        const roomName = selectedColorRoom;
        if (!roomName) return;
        const hex = '#' + document.getElementById('pickerHexInput').value.replace('#', '');
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        const newColor = { bg: hex + '20', border: hex, label: hex };
        roomColorMap[roomName] = newColor;
        _saveUserOverride(roomName);
        const room = roomList.find(r => r.name === roomName);
        if (room && room.id) {
            fetch(`${API_BASE}/rooms/${room.id}/color`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ colorData: JSON.stringify(newColor) })
            }).catch(() => {});
        }
        document.getElementById('colorPickerModal').classList.remove('active');
        renderRoomChips();
        updateView();
    };
}

// ====== 左側邊欄：迷你月曆 ======
let _miniCalDate = new Date();
function renderMiniCalendar() {
    const titleEl = document.getElementById('miniCalTitle');
    const daysEl = document.getElementById('miniCalDays');
    if (!titleEl || !daysEl) return;
    const year = _miniCalDate.getFullYear();
    const month = _miniCalDate.getMonth();
    titleEl.textContent = `${months[month]} ${year}`;
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();
    const todayStr = getTodayStr();
    let html = '';
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    for (let i = firstDay - 1; i >= 0; i--) {
        const d = prevLastDate - i;
        const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        html += `<div class="mini-cal-day other-month" data-date="${dateStr}">${d}</div>`;
    }
    for (let i = 1; i <= lastDate; i++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === getFormattedDate(selectedCalendarDate);
        html += `<div class="mini-cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-date="${dateStr}">${i}</div>`;
    }
    const totalCells = firstDay + lastDate;
    const remaining = (7 - (totalCells % 7)) % 7;
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    for (let i = 1; i <= remaining; i++) {
        const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
        html += `<div class="mini-cal-day other-month" data-date="${dateStr}">${i}</div>`;
    }
    daysEl.innerHTML = html;
    daysEl.querySelectorAll('.mini-cal-day[data-date]').forEach(el => {
        el.onclick = () => {
            const d = new Date(el.dataset.date + 'T00:00:00');
            selectedCalendarDate = new Date(d);
            _miniCalDate = new Date(d.getFullYear(), d.getMonth(), 1);
            if (viewSelect.value === 'month') {
                currentDate = new Date(d.getFullYear(), d.getMonth(), 1);
                updateView();
            } else if (viewSelect.value === 'week') {
                currentDate = new Date(d);
                updateView();
            } else {
                // day view
                updateView();
            }
        };
    });
}

// 重新繪製迷你月曆（保持獨立月份，不自動跳回主視圖月份）
function syncMiniCalendar() {
    renderMiniCalendar();
}

// 初始化邊欄事件
(function initSidebar() {
    const prevBtn = document.getElementById('miniCalPrev');
    const nextBtn = document.getElementById('miniCalNext');
    if (prevBtn) prevBtn.onclick = () => { _miniCalDate.setMonth(_miniCalDate.getMonth() - 1); renderMiniCalendar(); };
    if (nextBtn) nextBtn.onclick = () => { _miniCalDate.setMonth(_miniCalDate.getMonth() + 1); renderMiniCalendar(); };
})();
    
function exportPublicCalendarJson(){
  const publicData = {
    rooms: roomList.map(r => ({name:r.name, short:r.short})),
    events: eventsData,
    updateTime: new Date().toLocaleString()
  };
  const jsonStr = JSON.stringify(publicData, null, 2);
  const blob = new Blob([jsonStr], {type:"application/json"});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = "calendar-data.json";
  a.click();
}

// 讀取公告（從後端）
async function getAnnouncement() {
  try {
    const res = await fetch(`${API_BASE}/announcement`);
    const data = await res.json();
    return data.ok ? data.content : "";
  } catch { return ""; }
}

// 渲染公告到頁面
async function renderAnnouncement() {
  const text = await getAnnouncement();
  const bar = document.querySelector(".announcement-bar");
  const span = document.getElementById("announcementText");
  span.textContent = text.trim();
  
  if(text.trim() !== ""){
    bar.classList.add("show");
  }else{
    bar.classList.remove("show");
  }
}

// 儲存公告（到後端）
async function saveAnnouncement(text) {
  try {
    await fetch(`${API_BASE}/announcement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.trim() })
    });
  } catch(err) { console.error("公告儲存失敗:", err); }
  renderAnnouncement();
}

// === Todos ===
let todosData = [];
let holidaysData = [];
let holidaysYearLoaded = 0;
let leavesData = [];

async function loadTodos() {
    try {
        const res = await fetch(`${API_BASE}/todos`);
        const json = await res.json();
        if (json.ok) todosData = json.data;
    } catch (err) { console.error("載入待辦事項失敗:", err); }
}

async function loadHolidays(year) {
    if (holidaysYearLoaded === year && holidaysData.length > 0) return;
    try {
        const res = await fetch(`${API_BASE}/holidays?year=${year}`);
        const json = await res.json();
        if (json.ok) {
            holidaysData = json.data;
            holidaysYearLoaded = year;
        }
    } catch (err) { console.error("載入假期失敗:", err); }
}

function isHoliday(dateStr) {
    return holidaysData.find(h => h.date === dateStr);
}

function isLeave(dateStr, employee) {
    return leavesData.find(l => l.employee === employee && l.leaveDate <= dateStr && (l.endDate || l.leaveDate) >= dateStr);
}

function getLeavesForDate(dateStr) {
    return leavesData.filter(l => l.leaveDate <= dateStr && (l.endDate || l.leaveDate) >= dateStr);
}

async function loadLeaves() {
    try {
        const res = await fetch(`${API_BASE}/employee-leaves`);
        const json = await res.json();
        if (json.ok) leavesData = json.data;
    } catch (err) { console.error("載入員工假期失敗:", err); }
}

function renderTodos() {
    const wrap = document.getElementById('todoListWrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (todosData.length === 0) {
        wrap.innerHTML = '<div style="color:#888;text-align:center;padding:12px;">暫無待辦事項</div>';
        return;
    }
    // Group by title+startTime+endTime+room+employee+isAllDay
    const groups = {};
    todosData.forEach(todo => {
        const key = [todo.title, todo.startTime||'', todo.endTime||'', todo.room||'', todo.employee||'', todo.isAllDay?'1':'0'].join('|');
        if (!groups[key]) groups[key] = [];
        groups[key].push(todo);
    });
    const groupKeys = Object.keys(groups);
    window._todoGroups = groups;
    window._todoGroupKeys = groupKeys;
    groupKeys.forEach((key, idx) => {
        const todos = groups[key];
        const todo = todos[0];
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid #eee;';
        let timeStr = todo.isAllDay ? '全日' : '';
        if (todo.startTime && todo.endTime) timeStr = todo.startTime + '-' + todo.endTime;
        else if (todo.startTime) timeStr = todo.startTime + '-';
        // Collect weekday pattern
        const dowNames = ['日','一','二','三','四','五','六'];
        const dows = [...new Set(todos.map(t => { const d = new Date(t.startDate+'T00:00:00'); return d.getDay(); }))].sort();
        let dowStr = dows.length > 1 ? '逢星期' + dows.map(d => dowNames[d]).join('/') : '';
        let info = `<div><b>${todo.title}</b><br><span style="font-size:12px;color:#666;">${timeStr}`;
        if (dowStr) info += `｜${dowStr}`;
        if (todos.length > 1) info += `｜共${todos.length}條`;
        if (todo.room) info += `｜${todo.room}`;
        if (todo.employee) info += `｜${todo.employee}`;
        info += '</span></div>';
        const btn = document.createElement('button');
        btn.className = 'delete-x-btn';
        btn.title = '刪除整批';
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        btn.onclick = () => deleteTodoGroupByKey(idx);
        div.innerHTML = info;
        div.appendChild(btn);
        wrap.appendChild(div);
    });
}

async function deleteTodoGroupByKey(idx) {
    const key = window._todoGroupKeys[idx];
    const todos = window._todoGroups[key];
    if (!todos || !todos.length) return;
    if (!clickGuardKey('delTodo_' + key)) return;
    const todo = todos[0];
    if (!confirm(`確定刪除此批「${todo.title}」所有 ${todos.length} 條待辦事項？`)) return;
    try {
        const ids = todos.map(t => t.id);
        await fetch(`${API_BASE}/todos/batch-delete-by-ids`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        await loadTodos();
        renderTodos();
        updateView();
    } catch (err) { alert('刪除失敗：' + err.message); }
}

function showTodoDetail(todo) {
    const modal = document.getElementById('todoDetailModal');
    document.getElementById('todoDetailTitle').textContent = todo.title;
    let dateText = todo.startDate;
    if (todo.endDate !== todo.startDate) dateText += ' ~ ' + todo.endDate;
    document.getElementById('todoDetailDate').textContent = '日期：' + dateText;
    let timeText = todo.isAllDay ? '全日' : (todo.startTime || '');
    if (timeText && todo.endTime) timeText += ' ~ ' + todo.endTime;
    document.getElementById('todoDetailTime').textContent = timeText ? '時間：' + timeText : '';
    document.getElementById('todoDetailRoom').textContent = todo.room || '';
    document.getElementById('todoDetailEmployee').innerHTML = '負責人：<span>' + (todo.employee || '') + '</span>';

    const delBtn = document.getElementById('btnDeleteTodoDetail');
    delBtn.onclick = async () => {
        if (!clickGuard(delBtn)) return;
        if (!confirm('確定刪除此待辦事項？')) return;
        await fetch(`${API_BASE}/todos/${todo.id}`, { method: 'DELETE' });
        modal.classList.remove("active");
        await loadTodos(); renderTodos(); updateView();
    };
    document.getElementById('btnEditTodoDetail').onclick = () => {
        modal.classList.remove("active");
        editTodoItem(todo);
    };
    document.getElementById('btnCloseTodoDetail').onclick = () => modal.classList.remove("active");
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("active"); };
    modal.classList.add("active");
}

function editTodoItem(todo) {
    try {
        populateTodoDropdowns();
        document.getElementById('todoTitle').value = todo.title;
        document.getElementById('todoStartDate').value = todo.startDate;
        document.getElementById('todoEndDate').value = todo.endDate;
        document.getElementById('todoStartDate').dataset.prev = todo.startDate;
        document.getElementById('todoStartTime').value = todo.startTime || '';
        document.getElementById('todoEndTime').value = todo.endTime || '';
        document.getElementById('todoRoom').value = todo.room || '';
        document.getElementById('todoEmployee').value = todo.employee || '';
        document.getElementById('todoAllDay').checked = todo.isAllDay;
        document.getElementById('todosModal').classList.add("active");
        const addBtn = document.getElementById('addTodoBtn');
        addBtn.textContent = '更新待辦事項';
        addBtn.dataset.editId = todo.id;
    } catch (err) {
        console.error('editTodoItem error:', err);
        alert('編輯載入失敗：' + err.message);
    }
}

// old single deleteTodo removed — now using deleteTodoGroup and detail modal

// Inject todo marker CSS
(function(){
    const style = document.createElement('style');
    style.textContent = `
        .todo-marker {
            display: inline-block;
            width: 0; height: 0;
            border-top: 4px solid transparent;
            border-bottom: 4px solid transparent;
            border-left: 6px solid #f9a825;
            margin-right: 4px;
            vertical-align: middle;
        }
        .event-label .todo-marker {
            border-top: 3px solid transparent;
            border-bottom: 3px solid transparent;
            border-left: 5px solid #f9a825;
        }
        .day .event-label.todo-label {
            opacity: 0.9;
        }
    `;
    document.head.appendChild(style);
})();

// === Employee Leaves UI ===
(function(){
    const tabs = document.querySelectorAll('.todo-tab');
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => { t.classList.remove('active'); t.style.color = '#888'; t.style.borderBottomColor = 'transparent'; });
            tab.classList.add('active'); tab.style.color = 'var(--primary-color)'; tab.style.borderBottomColor = 'var(--primary-color)';
            const target = tab.dataset.tab;
            document.getElementById('tabTodos').style.display = target === 'todos' ? 'block' : 'none';
            document.getElementById('tabLeaves').style.display = target === 'leaves' ? 'block' : 'none';
        };
    });

    function populateLeaveEmployeeDropdown() {
        const sel = document.getElementById('leaveEmployee');
        if (!sel) return;
        sel.innerHTML = '<option value="">請選擇員工</option>';
        empList.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.name; opt.textContent = e.name;
            sel.appendChild(opt);
        });
    }

    const addLeaveBtn = document.getElementById('addLeaveBtn');
    if (addLeaveBtn) {
        addLeaveBtn.onclick = async () => {
            if (!clickGuard(addLeaveBtn)) return;
            const employee = document.getElementById('leaveEmployee').value;
            const leaveDate = document.getElementById('leaveStartDate').value;
            const endDate = document.getElementById('leaveEndDate').value;
            const leaveType = document.getElementById('leaveType').value;
            if (!employee || !leaveDate) return alert('請選擇員工和開始日期');
            const finalEndDate = endDate || leaveDate;
            if (finalEndDate < leaveDate) return alert('結束日期不能早於開始日期');
            try {
                const res = await fetch(`${API_BASE}/employee-leaves`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ employee, leaveDate, endDate: finalEndDate, leaveType })
                });
                const json = await res.json();
                if (!json.ok) return alert(json.msg);
                document.getElementById('leaveStartDate').value = getTodayStr();
                document.getElementById('leaveEndDate').value = getTodayStr();
                document.getElementById('leaveStartDate').dataset.prev = getTodayStr();
                document.getElementById('leaveType').value = '';
                await loadLeaves(); if (window._renderLeaves) window._renderLeaves(); updateView();
            } catch (err) { alert('新增失敗：' + err.message); }
        };
    }

    function renderLeaves() {
        const wrap = document.getElementById('leaveListWrap');
        if (!wrap) return;
        wrap.innerHTML = '';
        if (leavesData.length === 0) {
            wrap.innerHTML = '<div style="color:#888;text-align:center;padding:12px;">暫無員工假期記錄</div>';
            return;
        }
        const sorted = [...leavesData].sort((a, b) => a.leaveDate.localeCompare(b.leaveDate) || a.employee.localeCompare(b.employee));
        sorted.forEach(leave => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid #eee;';
            const typeStr = leave.leaveType ? ` (${leave.leaveType})` : '';
            const dateStr = (leave.endDate && leave.endDate !== leave.leaveDate) ? `${leave.leaveDate} ~ ${leave.endDate}` : leave.leaveDate;
            div.innerHTML = `<div><span class="leave-square" style="margin-right:6px;"></span><b>${leave.employee}</b> — ${dateStr}${typeStr}</div>`;
            const btn = document.createElement('button');
            btn.className = 'delete-x-btn';
            btn.title = '刪除';
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            btn.onclick = async () => {
                if (!clickGuard(btn)) return;
                const dateDisplay = (leave.endDate && leave.endDate !== leave.leaveDate) ? `${leave.leaveDate} ~ ${leave.endDate}` : leave.leaveDate;
                if (!confirm(`確定刪除 ${leave.employee} ${dateDisplay} 的假期記錄？`)) return;
                await fetch(`${API_BASE}/employee-leaves/${leave.id}`, { method: 'DELETE' });
                await loadLeaves(); renderLeaves(); updateView();
            };
            div.appendChild(btn);
            wrap.appendChild(div);
        });
    }

    window._renderLeaves = renderLeaves;
    window._populateLeaveEmployeeDropdown = populateLeaveEmployeeDropdown;
})();

function showLeaveDetail(leave) {
    const modal = document.getElementById('todoDetailModal');
    document.getElementById('todoDetailTitle').textContent = leave.employee + ' 員工假期';
    const dateStr = (leave.endDate && leave.endDate !== leave.leaveDate) ? `${leave.leaveDate} ~ ${leave.endDate}` : leave.leaveDate;
    document.getElementById('todoDetailDate').textContent = '日期：' + dateStr;
    document.getElementById('todoDetailTime').textContent = leave.leaveType ? '類型：' + leave.leaveType : '';
    document.getElementById('todoDetailRoom').textContent = '';
    document.getElementById('todoDetailEmployee').textContent = '';

    const delLeaveBtn = document.getElementById('btnDeleteTodoDetail');
    delLeaveBtn.onclick = async () => {
        if (!clickGuard(delLeaveBtn)) return;
        if (!confirm('確定刪除此假期記錄？')) return;
        await fetch(`${API_BASE}/employee-leaves/${leave.id}`, { method: 'DELETE' });
        modal.classList.remove("active");
        await loadLeaves(); updateView();
    };
    document.getElementById('btnEditTodoDetail').onclick = () => {
        modal.classList.remove("active");
    };
    document.getElementById('btnCloseTodoDetail').onclick = () => modal.classList.remove("active");
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("active"); };
    modal.classList.add("active");
}

// ====== 側欄收合 ======
 function initSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const layout = document.querySelector('.main-layout');
    if (!toggle || !layout) return;
    if (toggle.dataset.sidebarInit) return;
    toggle.dataset.sidebarInit = '1';
    const STORAGE_KEY = 'sidebarCollapsed';
    const mq = window.matchMedia(MOBILE_MODE_MQ);

    const applyResponsiveSidebar = () => {
        if (mq.matches) {
            layout.classList.add('collapsed');
            toggle.textContent = '▶';
            toggle.title = '展開側欄';
        } else {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved === '1') {
                layout.classList.add('collapsed');
                toggle.textContent = '▶';
                toggle.title = '展開側欄';
            } else {
                layout.classList.remove('collapsed');
                toggle.textContent = '◀';
                toggle.title = '收合側欄';
            }
        }
        window.dispatchEvent(new Event('resize'));
    };

    applyResponsiveSidebar();
    if (mq.addEventListener) {
        mq.addEventListener('change', applyResponsiveSidebar);
    }

    toggle.onclick = () => {
        const isCollapsed = layout.classList.toggle('collapsed');
        toggle.textContent = isCollapsed ? '▶' : '◀';
        toggle.title = isCollapsed ? '展開側欄' : '收合側欄';
        localStorage.setItem(STORAGE_KEY, isCollapsed ? '1' : '0');
        window.dispatchEvent(new Event('resize'));
    };
}
