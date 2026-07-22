const express = require('express');
const cors = require('cors');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./db/database.sqlite', (err) => {
    if (err) console.error('資料庫連線失敗', err.message);
    else console.log('✅ SQLite 連線成功');
});

const PORT = 3000;

app.use(cors());
app.use(express.json());

// ========== 自動建立資料表 ==========
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','admin')),
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        short_name TEXT DEFAULT '',
        color_data TEXT DEFAULT '',
        is_deleted INTEGER DEFAULT 0,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        res_date TEXT NOT NULL,
        title TEXT NOT NULL,
        employee TEXT NOT NULL,
        room_name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        creator_id INTEGER,
        is_deleted INTEGER DEFAULT 0,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS announcement (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        operate_type TEXT NOT NULL,
        target_res_id INTEGER,
        content TEXT,
        ip TEXT,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========== 登入 API ==========
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, msg: "請輸入帳號密碼" });
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.json({ ok: false, msg: err.message });
        if (!user) return res.json({ ok: false, msg: "帳號不存在" });
        if (!bcrypt.compareSync(password, user.password)) return res.json({ ok: false, msg: "密碼錯誤" });
        res.json({ ok: true, data: { id: user.id, username: user.username, role: user.role } });
    });
});

// ================================================================
//  預約 CRUD
// ================================================================

app.post('/api/reservations', (req, res) => {
    const { date, name, employee, room, startTime, endTime } = req.body;
    if (!date || !name || !employee || !room || !startTime || !endTime) {
        return res.json({ ok: false, msg: "所有欄位皆為必填" });
    }
    const sql = `INSERT INTO reservations (res_date, title, employee, room_name, start_time, end_time) VALUES (?,?,?,?,?,?)`;
    db.run(sql, [date, name, employee, room, startTime, endTime], function (err) {
        if (err) return res.json({ ok: false, msg: "儲存失敗：" + err.message });
        res.json({ ok: true, data: { id: this.lastID } });
    });
});

app.get('/api/reservations', (req, res) => {
    db.all(`SELECT id, res_date as date, title as name, employee, room_name as room, start_time as startTime, end_time as endTime FROM reservations WHERE is_deleted = 0 ORDER BY res_date, start_time`, [], (err, rows) => {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, data: rows });
    });
});

app.put('/api/reservations/:id', (req, res) => {
    const id = req.params.id;
    const { date, name, employee, room, startTime, endTime } = req.body;
    if (!date || !name || !employee || !room || !startTime || !endTime) {
        return res.json({ ok: false, msg: "所有欄位皆為必填" });
    }
    const sql = `UPDATE reservations SET res_date=?, title=?, employee=?, room_name=?, start_time=?, end_time=?, update_at=CURRENT_TIMESTAMP WHERE id=? AND is_deleted=0`;
    db.run(sql, [date, name, employee, room, startTime, endTime, id], function (err) {
        if (err) return res.json({ ok: false, msg: "更新失敗：" + err.message });
        if (this.changes === 0) return res.json({ ok: false, msg: "找不到該預約" });
        res.json({ ok: true });
    });
});

app.delete('/api/reservations/batch/date/:date', (req, res) => {
    const date = req.params.date;
    db.run(`UPDATE reservations SET is_deleted = 1, update_at = CURRENT_TIMESTAMP WHERE res_date = ? AND is_deleted = 0`, [date], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, deleted: this.changes });
    });
});

app.delete('/api/reservations/batch/month/:ym', (req, res) => {
    const ym = req.params.ym;
    db.run(`UPDATE reservations SET is_deleted = 1, update_at = CURRENT_TIMESTAMP WHERE res_date LIKE ? AND is_deleted = 0`, [ym + '%'], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, deleted: this.changes });
    });
});

// 批量匯入預約
app.post('/api/reservations/batch', (req, res) => {
    const { list } = req.body;
    if (!Array.isArray(list) || list.length === 0) {
        return res.json({ ok: false, msg: "匯入清單為空" });
    }
    let successCount = 0;
    let failCount = 0;
    const stmt = `INSERT INTO reservations (res_date, title, employee, room_name, start_time, end_time) VALUES (?,?,?,?,?,?)`;
    let pending = list.length;
    list.forEach(item => {
        db.run(stmt, [item.date, item.name, item.employee, item.room, item.startTime, item.endTime], function (err) {
            if (err) failCount++;
            else successCount++;
            pending--;
            if (pending === 0) {
                res.json({ ok: true, success: successCount, fail: failCount });
            }
        });
    });
});

app.delete('/api/reservations/:id', (req, res) => {
    const id = req.params.id;
    db.run(`UPDATE reservations SET is_deleted = 1, update_at = CURRENT_TIMESTAMP WHERE id = ?`, [id], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        if (this.changes === 0) return res.json({ ok: false, msg: "找不到該預約" });
        res.json({ ok: true });
    });
});

// ================================================================
//  房間 CRUD
// ================================================================

// 取得所有有效房間（日曆顯示用）
app.get('/api/rooms', (req, res) => {
    db.all(`SELECT id, name, short_name as short, color_data as colorData FROM rooms WHERE is_deleted = 0 ORDER BY name`, [], (err, rows) => {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, data: rows });
    });
});

// 取得全部房間含回收站（設定面板用）
app.get('/api/rooms/all', (req, res) => {
    db.all(`SELECT id, name, short_name as short, color_data as colorData, is_deleted FROM rooms ORDER BY is_deleted, name`, [], (err, rows) => {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, data: rows });
    });
});

// 新增房間
app.post('/api/rooms', (req, res) => {
    const { name, short, colorData } = req.body;
    if (!name) return res.json({ ok: false, msg: "房間名稱不可空白" });
    const sql = `INSERT INTO rooms (name, short_name, color_data) VALUES (?, ?, ?)`;
    db.run(sql, [name, short || '', colorData || ''], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.json({ ok: false, msg: "房間名稱已存在" });
            return res.json({ ok: false, msg: err.message });
        }
        res.json({ ok: true, data: { id: this.lastID, name, short: short || '', colorData: colorData || '' } });
    });
});

// 更新房間縮寫
app.put('/api/rooms/:id/short', (req, res) => {
    const id = req.params.id;
    const { short } = req.body;
    db.run(`UPDATE rooms SET short_name = ? WHERE id = ?`, [short || '', id], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true });
    });
});

// 更新房間配色
app.put('/api/rooms/:id/color', (req, res) => {
    const id = req.params.id;
    const { colorData } = req.body;
    db.run(`UPDATE rooms SET color_data = ? WHERE id = ?`, [colorData || '', id], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true });
    });
});

// 軟刪除房間（移至回收站）
app.delete('/api/rooms/:id', (req, res) => {
    const id = req.params.id;
    // 先檢查是否還有預約在使用
    db.get(`SELECT room_name FROM rooms WHERE id = ?`, [id], (err, room) => {
        if (err) return res.json({ ok: false, msg: err.message });
        if (!room) return res.json({ ok: false, msg: "找不到該房間" });
        db.get(`SELECT COUNT(*) as cnt FROM reservations WHERE room_name = ? AND is_deleted = 0`, [room.room_name], (err2, row) => {
            if (err2) return res.json({ ok: false, msg: err2.message });
            if (row.cnt > 0) return res.json({ ok: false, msg: `房間「${room.room_name}」尚有 ${row.cnt} 筆預約，無法刪除` });
            db.run(`UPDATE rooms SET is_deleted = 1 WHERE id = ?`, [id], function (err3) {
                if (err3) return res.json({ ok: false, msg: err3.message });
                res.json({ ok: true });
            });
        });
    });
});

// 恢復回收站房間
app.put('/api/rooms/:id/restore', (req, res) => {
    const id = req.params.id;
    db.run(`UPDATE rooms SET is_deleted = 0 WHERE id = ?`, [id], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        if (this.changes === 0) return res.json({ ok: false, msg: "找不到該房間" });
        res.json({ ok: true });
    });
});

// 永久刪除房間
app.delete('/api/rooms/:id/permanent', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM rooms WHERE id = ?`, [id], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        if (this.changes === 0) return res.json({ ok: false, msg: "找不到該房間" });
        res.json({ ok: true });
    });
});

// 一鍵清空回收站
app.delete('/api/rooms/trash/empty', (req, res) => {
    db.run(`DELETE FROM rooms WHERE is_deleted = 1`, function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, deleted: this.changes });
    });
});

// ================================================================
//  員工 CRUD
// ================================================================

app.get('/api/employees', (req, res) => {
    db.all(`SELECT id, name FROM employees ORDER BY name`, [], (err, rows) => {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, data: rows });
    });
});

app.post('/api/employees', (req, res) => {
    const { name } = req.body;
    if (!name) return res.json({ ok: false, msg: "員工姓名不可空白" });
    db.run(`INSERT INTO employees (name) VALUES (?)`, [name], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.json({ ok: false, msg: "員工已存在" });
            return res.json({ ok: false, msg: err.message });
        }
        res.json({ ok: true, data: { id: this.lastID, name } });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM employees WHERE id = ?`, [id], function (err) {
        if (err) return res.json({ ok: false, msg: err.message });
        if (this.changes === 0) return res.json({ ok: false, msg: "找不到該員工" });
        res.json({ ok: true });
    });
});

// ================================================================
//  公告
// ================================================================

app.get('/api/announcement', (req, res) => {
    db.get(`SELECT content FROM announcement WHERE id = 1`, [], (err, row) => {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true, content: row?.content || "" });
    });
});

app.post('/api/announcement', (req, res) => {
    const { content } = req.body;
    db.run(`REPLACE INTO announcement (id, content) VALUES (1, ?)`, [content], err => {
        if (err) return res.json({ ok: false, msg: err.message });
        res.json({ ok: true });
    });
});

app.listen(PORT, () => {
    console.log(`伺服器啟動：http://localhost:${PORT}`);
});
