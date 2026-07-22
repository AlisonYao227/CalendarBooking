// --- 元素選取與初始化保持不變 ---
const API_BASE = "https://thriving-imagination-production-8d1a.up.railway.app/api";
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

// 新增：回收站（從後端載入 is_deleted=1 的房間）
let trashRoomList = [];
let selectedCalendarDate = new Date(); // 記住使用者點擊/滑鼠hover的日期，預設今日

// 房間、員工 從後端載入，初始為空陣列
let roomList = [];
let empList = [];

// 篩選狀態
let filterEmployee = "";
let filterRoom = "";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// 房間配色持久化存儲
let roomColorMap = {
  "Classroom 1": { bg: "#e3f2fd", border: "#2f70a4", label: "#2f70a4" },
  "Classroom 2": { bg: "#f1f8e9", border: "#8bc34a", label: "#8bc34a" },
  "VIP Room":    { bg: "#fff3e0", border: "#e1a138", label: "#e1a138" },
  "EDS":         { bg: "#f3e5f5", border: "#a46ac3", label: "#a46ac3" }
};

// 隨機生成房間配色函數【修復版：先順序取用未使用顏色，用完才循環】
function generateRandomRoomColor() {
  const colorPool = [
    "#80bcec", "#9ec078", "#bfa840", "#aa6bb5", "#736940",
    "#51a5b0", "#7657ac", "#5c66a3", "#74ccc3", "#f4805d",
    "#5f5c84", "#71386a", "#926180", "#5f9783", "#d07171",
    "#294051", "#251223", "#5c4b56", "#2c7b5e", "#a13434",
    "#294c51", "#280a47", "#4f1819", "#133528", "#4b1313"
  ];

  // 取出所有已經被佔用的 border 色
  const usedColors = Object.values(roomColorMap).map(item => item.border);
  // 篩選出還沒被使用的顏色
  const availableColors = colorPool.filter(color => !usedColors.includes(color));

  let border;
  if (availableColors.length > 0) {
    // 還有剩餘未使用顏色 → 從剩餘池隨機抽取，保證不重複
    border = availableColors[Math.floor(Math.random() * availableColors.length)];
  } else {
    // 25種全部用完，允許重複，隨機取全部池內顏色
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
    // 固定內建房間白名單，永遠強制使用原生配色，不隨機生成
    const builtInRooms = {
        "Classroom 1": { bg: "#e3f2fd", border: "#2f70a4", label: "#2f70a4" },
        "Classroom 2": { bg: "#f1f8e9", border: "#8bc34a", label: "#8bc34a" },
        "VIP Room":    { bg: "#fff3e0", border: "#e1a138", label: "#e1a138" },
        "EDS":         { bg: "#f3e5f5", border: "#a46ac3", label: "#a46ac3" }
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
                <button id="pwdOkBtn" style="padding:8px 18px;border:none;border-radius:6px;background:#4a90e2;color:#fff;cursor:pointer;font-size:13px;">確定</button>
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
    loadAllData();
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
// 一次性載入預約、房間、員工全域數據
async function loadAllData() {
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

        updateView();
        initFilterDropdowns();
    } catch (err) {
        console.error("載入後端數據失敗：", err);
    }
}

// 初始化篩選下拉選單
function initFilterDropdowns() {
    const filterEmp = document.getElementById('filterEmployee');
    const filterRoomEl = document.getElementById('filterRoom');
    if (!filterEmp || !filterRoomEl) return;
    
    // 員工篩選
    filterEmp.innerHTML = '<option value="">全部員工</option>';
    empList.forEach(emp => {
        const opt = document.createElement('option');
        opt.value = emp.name;
        opt.textContent = emp.name;
        filterEmp.appendChild(opt);
    });
    
    // 房間篩選
    filterRoomEl.innerHTML = '<option value="">全部房間</option>';
    roomList.forEach(room => {
        const opt = document.createElement('option');
        opt.value = room.name;
        opt.textContent = room.name;
        filterRoomEl.appendChild(opt);
    });
    
    // 事件監聽
    filterEmp.onchange = (e) => {
        filterEmployee = e.target.value;
        updateView();
    };
    filterRoomEl.onchange = (e) => {
        filterRoom = e.target.value;
        updateView();
    };
}

// 取得篩選後的事件列表
function getFilteredData() {
    return eventsData.filter(ev => {
        if (filterEmployee && ev.employee !== filterEmployee) return false;
        if (filterRoom && ev.room !== filterRoom) return false;
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

    if(importBtn){
    importBtn.onclick = () => {
        // 每次點擊匯入，清空上一次的跳過記錄
    currentImportSkipList = [];
        importFileInput.click();
    };
    }

    if(importTipBtn){
    importTipBtn.onclick = (e) => {
        e.stopPropagation();
        // 固定前置格式說明，每次點擊都顯示
        let tipText = "【Excel標準格式規範】\n請按照系統匯出Excel欄位建立表格：\n必填欄位：日期、活動名稱、預約員工、房間、開始時間、結束時間\n時間格式範例：09:00、23:30；不可跨午夜\n\n";

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

    importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async function(evt) {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                
                if (jsonData.length === 0) {
                    alert("Excel 內沒有任何資料");
                    return;
                }
                
                let successCount = 0;
                let skipCount = 0;
                let newRoomCount = 0;
                let newEmpCount = 0;
                const skipList = [];
                const importList = [];
                
                // 先收集需要自動新增的房間和員工
                const newRooms = new Set();
                const newEmps = new Set();
                
                jsonData.forEach((row, idx) => {
                    const dateRaw = row['日期'] || row['date'] || row.Date;
                    const name = row['活動名稱'] || row['名稱'] || row['name'] || row.Name;
                    const employee = row['預約員工'] || row['預約人'] || row['employee'] || row.Employee;
                    const room = row['房間'] || row['room'] || row.Room;
                    const startRaw = row['開始時間'] || row['startTime'] || row['start'] || row.Start;
                    const endRaw = row['結束時間'] || row['endTime'] || row['end'] || row.End;
                    
                    if (dateRaw === undefined || !name || !employee || !room || startRaw === undefined || endRaw === undefined) {
                        skipCount++;
                        skipList.push(`第${idx+2}行：欄位不全`);
                        return;
                    }
                    
                    const dateStr = excelDateToStr(dateRaw);
                    const sTime = excelTimeToStr(startRaw);
                    const eTime = excelTimeToStr(endRaw);
                    
                    if (sTime >= eTime) {
                        skipCount++;
                        skipList.push(`第${idx+2}行「${name}」：結束時間需晚於開始時間`);
                        return;
                    }
                    if (eTime > "23:30") {
                        skipCount++;
                        skipList.push(`第${idx+2}行「${name}」：結束時間不可超過23:30`);
                        return;
                    }
                    
                    const roomName = String(room).trim();
                    const empName = String(employee).trim();
                    
                    // 自動新增房間（尚未在後端）
                    if (!roomList.some(item => item.name === roomName) && !newRooms.has(roomName)) {
                        newRooms.add(roomName);
                        newRoomCount++;
                    }
                    
                    // 自動新增員工（尚未在後端）
                    if (!empList.some(e => e.name === empName) && !newEmps.has(empName)) {
                        newEmps.add(empName);
                        newEmpCount++;
                    }
                    
                    // 衝突檢測
                    const isConflict = eventsData.some(ev => {
                        return ev.date === dateStr && ev.room === roomName && sTime < ev.endTime && eTime > ev.startTime;
                    });
                    if (isConflict) {
                        skipCount++;
                        skipList.push(`第${idx+2}行「${name}」：${dateStr} ${roomName} 時段衝突`);
                        return;
                    }
                    
                    importList.push({
                        date: dateStr,
                        name: String(name).trim(),
                        employee: empName,
                        room: roomName,
                        startTime: sTime,
                        endTime: eTime
                    });
                    successCount++;
                });
                
                // 自動新增房間到後端
                for (const rName of newRooms) {
                    try {
                        const color = generateRandomRoomColor();
                        const res = await fetch(`${API_BASE}/rooms`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: rName, short: '', colorData: JSON.stringify(color) })
                        });
                        const result = await res.json();
                        if (result.ok) roomColorMap[rName] = color;
                    } catch(e) { console.error("自動新增房間失敗:", e); }
                }
                
                // 自動新增員工到後端
                for (const eName of newEmps) {
                    try {
                        await fetch(`${API_BASE}/employees`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: eName })
                        });
                    } catch(e) { console.error("自動新增員工失敗:", e); }
                }
                
                // 批量匯入預約到後端
                if (importList.length > 0) {
                    try {
                        const res = await fetch(`${API_BASE}/reservations/batch`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ list: importList })
                        });
                        const result = await res.json();
                        if (!result.ok) {
                            skipCount += importList.length;
                            skipList.push("批量匯入失敗：" + result.msg);
                        }
                    } catch(err) {
                        skipCount += importList.length;
                        skipList.push("批量匯入失敗：" + err.message);
                    }
                }
                
                // 重新載入所有資料
                console.log("[IMPORT] calling loadAllData...");
                await loadAllData();
                console.log("[IMPORT] after loadAllData, eventsData.length=", eventsData.length, "eventsData=", JSON.stringify(eventsData.slice(-5)));
                updateView();
                
                currentImportSkipList = [...skipList];

let resultMsg = `匯入完成！
✅ 成功：${successCount} 條
⚠️ 跳過：${skipCount} 條`;
if (newRoomCount > 0) resultMsg += `
🏠 自動新增房間：${newRoomCount} 個`;
if (newEmpCount > 0) resultMsg += `
👤 自動新增員工：${newEmpCount} 位`;

if (skipList.length > 0) {
    if(successCount === 0){
        resultMsg += `

⚠️ 所有數據均跳過，極可能Excel欄位格式不匹配！
點擊匯入旁邊「i」小按鈕查看完整錯誤原因`;
    }else{
        resultMsg += `

點擊匯入旁邊「i」小按鈕可查看全部跳過異常明細`;
    }
}
alert(resultMsg);
                
            } catch (err) {
                console.error(err);
                alert("匯入失敗：檔案格式錯誤，請確認是標準 .xlsx 檔案");
            }
            
            importFileInput.value = "";
        };
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
        // 批量刪除專用密碼
        const BIN_PASSWORD = "123456";
        const inputBinPwd = await showPasswordPrompt("請輸入管理密碼，進入批量刪除功能：");

        // 點擊取消 → 直接結束
        if(inputBinPwd === null){
            return;
        }
        // 密碼錯誤，中止
        if(inputBinPwd !== BIN_PASSWORD){
            alert("密碼錯誤，無法進入批量刪除");
            return;
        }

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
    // 管理密碼
    const ADMIN_PASSWORD = "123456";
    const inputPwd = await showPasswordPrompt("請輸入管理密碼進入系統設定：");
    
    if(inputPwd === null){
        return;
    }
    if(inputPwd === ADMIN_PASSWORD){
        settingModal.classList.add('active');
        renderSettingLists();
    }else{
        alert("密碼錯誤");
    }
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
    saveAnnouncementBtn.onclick = () => {
        const txt = announcementInput.value;
        saveAnnouncement(txt);
        alert("公告設定已儲存");
    };
    }

    // --- 新增房間 ---
    if(addRoomBtn){
    addRoomBtn.onclick = async () => {
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
    } catch(e) { alert("新增失敗：" + e.message); }
}
    }

    // --- 新增員工 ---
    if(addEmpBtn){
    addEmpBtn.onclick = async () => {
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
        } catch(e) { alert("新增失敗：" + e.message); }
    }
}
});

// --- 視圖控制 ---
function updateView() {
    const view = viewSelect.value;
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
    if (view === 'month') renderMonthView();
    else renderTimelineView(view);

    //切換視圖自動同步匯出下拉灰化
    syncExportRangeOptionState();
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

function changeDate(step) {
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
    updateView();
}

// --- 1. 大月曆（滑鼠hover預載日期、點擊永久鎖定）
function renderMonthView() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    monthYear.innerText = `${months[month]} ${year}`;
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    calendarDays.innerHTML = "";

    for (let i = 0; i < firstDay; i++) calendarDays.innerHTML += `<div class="empty"></div>`;

    for (let i = 1; i <= lastDate; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayDiv = document.createElement("div");
        dayDiv.className = "day";
        if (dateStr === getTodayStr()) dayDiv.classList.add("today");
        dayDiv.innerHTML = `<span class="day-number">${i}</span>`;
        
        // 滑鼠移入，自動預設為切換Day的基準日期
        dayDiv.onmouseenter = () => {
            selectedCalendarDate = new Date(dateStr);
        };
        // 點擊格子，永久鎖定該日期
        if(dayDiv){
        dayDiv.onclick = () => { 
            selectedDateStr = dateStr;
            selectedCalendarDate = new Date(dateStr);
            openBookingForm(dateStr);
         };
        }

        eventsData.forEach((ev, index) => {
    if (ev.date === dateStr) {
        // 套用篩選
        if (filterEmployee && ev.employee !== filterEmployee) return;
        if (filterRoom && ev.room !== filterRoom) return;
        const evEl = document.createElement("div");
        evEl.className = "event-label";
        const style = getRoomStyle(ev.room);
        const dispRoom = getRoomDisplayText(ev.room);
        // 嚴格使用反引號，順序：時間 → 名稱 → 房間
        evEl.innerHTML = `<strong>${ev.startTime}</strong> ${ev.name}｜${dispRoom}`;
        evEl.style.cssText = `
            background-color: ${style.label};
            color:#ffffff;
            font-size:11px;
            line-height:1.3;
            padding:2px 4px;
            border-radius:3px;
            margin:1px 0;
            overflow:hidden;
            white-space:nowrap;
            text-overflow:ellipsis;
            cursor:pointer;
        `;
        evEl.onclick = (e) => {
            e.stopPropagation();
            showEventDetails(index);
        };
        dayDiv.appendChild(evEl);
    }
});
        calendarDays.appendChild(dayDiv);
    }
}

// --- 2. 時間軸（Day視圖永遠渲染滑鼠hover/點擊選取的日期）
function renderTimelineView(type) {
    const weekHeader = document.getElementById('weekHeader');
    eventGrid.innerHTML = "";
    timeColumn.innerHTML = "";
    eventGrid.className = "event-grid";
eventGrid.classList.remove("week-mode");

    for (let h = 0; h <= 23; h++) {
        timeColumn.innerHTML += `<div class="time-slot-label">${String(h).padStart(2,'0')}:00</div>`;
    }

    if (type === 'day') {
        weekHeader.style.display = 'none';
        monthYear.innerText = formatDateFull(selectedCalendarDate);
        const col = document.createElement('div');
        col.className = 'day-column';
        renderEventsIntoColumn(col, getFormattedDate(selectedCalendarDate));
        eventGrid.appendChild(col);
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
            const col = document.createElement('div');
            col.className = 'day-column';
            renderEventsIntoColumn(col, getFormattedDate(targetDate));
            eventGrid.appendChild(col);
        }
    }
}

function renderEventsIntoColumn(columnElement, dateStr) {
    const startHour = 0;
    const dayEvents = eventsData.filter(ev => {
        if (ev.date !== dateStr) return false;
        if (filterEmployee && ev.employee !== filterEmployee) return false;
        if (filterRoom && ev.room !== filterRoom) return false;
        return true;
    });
    const timeGroup = {};
    // 按開始時間分組
    dayEvents.forEach(ev => {
        if (!timeGroup[ev.startTime]) timeGroup[ev.startTime] = [];
        timeGroup[ev.startTime].push(ev);
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
                const [sH, sM] = ev.startTime.split(':').map(Number);
                const top = ((sH - startHour) * 60) + sM;
                let height = ((ev.endTime.split(':').map(Number)[0] - sH) * 60) + (ev.endTime.split(':').map(Number)[1] - sM);
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
                const [sH, sM] = ev.startTime.split(':').map(Number);
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
                evEl.innerHTML = `<strong>${ev.startTime}</strong> ${ev.name}｜${dispRoom}`;
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
                const [sH, sM] = baseEv.startTime.split(':').map(Number);
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
    document.getElementById('viewEventTime').innerText = `${ev.startTime} - ${ev.endTime}`;
    document.getElementById('viewEventRoom').innerText = ev.room;
    document.querySelector('#viewEventEmployee span').innerText = ev.employee;
    document.getElementById('detailBar').style.backgroundColor = style.border;
    viewDetailModal.classList.add('active');
}

function openBookingForm(dateStr, index = -1) {
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
        formTitle.innerText = `新增預約 (${dateStr})`;
        document.getElementById("eventTitle").value = "";
        if(empList.length > 0){
            document.getElementById("employeeName").value = empList[0].name;
        }
        // 新建預約預設第一個房間
        if(roomList.length > 0){
            roomSelect.value = roomList[0].name;
        }
    } else {
        const ev = eventsData[index];
        formTitle.innerText = `編輯預約 (${dateStr})`;
        document.getElementById("eventTitle").value = ev.name;
        document.getElementById("employeeName").value = ev.employee;
        document.getElementById("startTime").value = ev.startTime;
        document.getElementById("endTime").value = ev.endTime;

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

//確認預約按鈕
if(bookBtn){
bookBtn.onclick = async (e) => {
    if(e) e.preventDefault();
    if(e) e.stopPropagation();
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
    console.log("[BOOK] cleaned:", {name, employee, room, startTime, endTime, date});

    // 3. 基礎空值攔截
    if (!name || !employee || !room) { console.log("[BOOK] BLOCKED: empty fields"); return alert("活動名稱、員工、房間不能空白"); }
    // 強制時間格式 HH:MM 長度檢查
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        console.log("[BOOK] BLOCKED: bad time format");
        return alert("時間格式必須為 00:00，不能包含其他文字");
    }
    if (startTime >= endTime) { console.log("[BOOK] BLOCKED: start >= end"); return alert("結束時間必須晚於開始時間"); }
    if(endTime > "23:30") { console.log("[BOOK] BLOCKED: endTime > 23:30"); return alert("結束時間不能超過 23:30"); }
    // 強制日期格式 YYYY-MM-DD 檢查
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.log("[BOOK] BLOCKED: bad date format");
        return alert("日期格式非法");
    }

    // 4. 組裝完全乾淨、符合後端規範的物件
    const newEv = {
        date: date,
        name: name,
        employee: employee,
        room: room,
        startTime: startTime,
        endTime: endTime
    };
    console.log("[BOOK] payload:", JSON.stringify(newEv));

    // 過去日期確認（若仍報錯可直接註釋這整段測試）
    const todayStr = getTodayStr();
    if(date < todayStr){
        const confirmPast = confirm("預約日期在今日之前，確認儲存？");
        if(!confirmPast) return;
    }

    // 前端時段衝突檢查
    const isConflict = eventsData.some((ev, idx) => {
        return idx !== currentViewIndex && ev.date === date && ev.room === room && startTime < ev.endTime && endTime > ev.startTime;
    });
    if (isConflict) { console.log("[BOOK] BLOCKED: conflict"); return alert("該時段房間已有預約"); }

    console.log("[BOOK] calling API...");
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
    if(range === "currentMonth"){
        eventsData.forEach(ev=>{
            const y = parseInt(ev.date.split("-")[0]);
            const m = parseInt(ev.date.split("-")[1]) - 1;
            if(y === year && m === month) list.push(ev);
        })
    }else if(range === "currentDay"){
        const targetDay = getFormattedDate(selectedCalendarDate);
        eventsData.forEach(ev=>{
            if(ev.date === targetDay) list.push(ev);
        })
    }else if(range === "currentWeek"){
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        eventsData.forEach(ev=>{
            const evDate = new Date(ev.date);
            if(evDate >= startOfWeek && evDate <= endOfWeek) list.push(ev);
        })
    }else{
        list = [...eventsData];
    }
    // 套用員工/房間篩選
    if (filterEmployee) list = list.filter(ev => ev.employee === filterEmployee);
    if (filterRoom) list = list.filter(ev => ev.room === filterRoom);
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
    if(data.length === 0) return alert("該範圍無任何預約記錄");
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
    const sheetData = [
        ["日期","活動名稱","預約員工","房間","開始時間","結束時間"]
    ];
    data.forEach(ev=>{
        sheetData.push([
            ev.date,
            ev.name,
            ev.employee,
            ev.room,
            ev.startTime,
            ev.endTime
        ])
    })
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(book, sheet, "預約清單");
    XLSX.writeFile(book, fileName);
}

// 匯出 PDF
function exportPdf(range){
    const data = getFilterEvents(range);
    if(data.length === 0) return alert("該範圍無任何預約記錄");
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
        const targetYear = year;
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const monthsEN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const colW = pageW / 7;
        const headerH = 8;
        const titleH = 10;
        const margin = 4;

        for(let m = 0; m < 12; m++){
            if(m > 0) doc.addPage();
            const firstDay = new Date(targetYear, m, 1).getDay();
            const lastDate = new Date(targetYear, m + 1, 0).getDate();
            const totalCells = firstDay + lastDate;
            const rows = Math.ceil(totalCells / 7);
            const cellH = (pageH - titleH - headerH - margin * 2) / rows;

            doc.setFontSize(16);
            doc.setTextColor(51);
            doc.text(`${monthsEN[m]} ${targetYear}`, pageW / 2, margin + 7, { align: 'center' });
            doc.setDrawColor(74, 144, 226);
            doc.setLineWidth(0.5);
            doc.line(margin, margin + titleH - 2, pageW - margin, margin + titleH - 2);

            const weekdays = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
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
            for(let i = 0; i < totalCells; i++){
                const col = i % 7;
                const row = Math.floor(i / 7);
                const x = margin + col * colW;
                const y = gridTop + row * cellH;

                doc.setDrawColor(215, 207, 207);
                doc.setLineWidth(0.2);
                doc.rect(x, y, colW, cellH);

                if(i >= firstDay){
                    const dayNum = i - firstDay + 1;
                    const dateStr = `${targetYear}-${String(m+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
                    doc.setFontSize(8);
                    doc.setFont(undefined, 'bold');
                    if(dateStr === getTodayStr()){
                        doc.setTextColor(74, 144, 226);
                    }else{
                        doc.setTextColor(51);
                    }
                    doc.text(String(dayNum), x + 2, y + 3.5);

                    const dayEvents = data.filter(ev => ev.date === dateStr);
                    doc.setFont(undefined, 'normal');
                    doc.setFontSize(6);
                    let ey = y + 7;
                    dayEvents.forEach(ev => {
                        if(ey + 3 > y + cellH) return;
                        const roomStyle = getRoomStyle(ev.room);
                        const hex = roomStyle.label || '#4a90e2';
                        const r = parseInt(hex.slice(1,3),16);
                        const g = parseInt(hex.slice(3,5),16);
                        const b = parseInt(hex.slice(5,7),16);
                        doc.setFillColor(r, g, b);
                        doc.rect(x + 0.5, ey - 2.5, colW - 1, 3.8, 'F');
                        doc.setTextColor(255, 255, 255);
                        doc.setFontSize(7);
                        const txt = `${ev.startTime} ${ev.name} - ${ev.room}`;
                        doc.text(txt, x + 1, ey);
                        ey += 4;
                    });
                    doc.setTextColor(51);
                }
            }
        }
        doc.save(fileName);
        return;
    }

    if(range === "currentWeek"){
        const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
        const gridTopY = margin + titleH + dayHeaderH;
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
                const hex = roomStyle.label || '#4a90e2';
                const r = parseInt(hex.slice(1,3),16);
                const g = parseInt(hex.slice(3,5),16);
                const b = parseInt(hex.slice(5,7),16);
                doc.setFillColor(r, g, b);
                const bx = margin + timeColW + evDateIdx * dayColW + 1;
                const bw = dayColW - 2;
                doc.roundedRect(bx, topY, bw, barH, 1, 1, 'F');

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

    setTimeout(()=>{
        html2pdf().set(opt).from(printDom).save().then(()=>{
            monthGrid.style.height = oldGridHeight;
            daysWrap.style.gridAutoRows = oldDayHeight;
        });
    }, 300);
}

/// ========== 匯入 Excel 工具函數（全域，放DOMContentLoaded外面） ==========
// Excel時間小數轉 HH:MM
function excelTimeToStr(timeVal) {
    if (typeof timeVal === 'number') {
        // 0~1 小數 = 一天的比例
        const totalMin = Math.round(timeVal * 24 * 60);
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

// 取得日曆顯示用房間文字：有縮寫顯示縮寫，否則全名；不在roomList內一律全名
function getRoomDisplayText(roomName){
    const found = roomList.find(r => r.name === roomName);
    if(found && found.short && found.short.trim() !== ""){
        return found.short.trim();
    }
    return roomName;
}
    
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
