const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== Helper: log operation ==========
async function logOperation(operateType, targetResId, content, ip, detail) {
    try {
        await pool.query(
            `INSERT INTO operation_logs (operate_type, target_res_id, content, ip, detail) VALUES ($1, $2, $3, $4, $5)`,
            [operateType, targetResId || null, content, ip || '', detail ? JSON.stringify(detail) : null]
        );
    } catch (e) {
        console.error('操作紀錄寫入失敗:', e.message);
    }
}

// ========== 自動建立資料表 ==========
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user','admin')),
            create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            short_name TEXT DEFAULT '',
            color_data TEXT DEFAULT '',
            is_deleted INTEGER DEFAULT 0,
            create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reservations (
            id SERIAL PRIMARY KEY,
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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS announcement (
            id INTEGER PRIMARY KEY DEFAULT 1,
            content TEXT,
            update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS operation_logs (
            id SERIAL PRIMARY KEY,
            operate_type TEXT NOT NULL,
            target_res_id INTEGER,
            content TEXT,
            detail TEXT,
            ip TEXT,
            create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

    // Seed admin user if not exists
    const adminCheck = await pool.query(`SELECT id FROM users WHERE username = 'admin'`);
    if (adminCheck.rows.length === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        await pool.query(`INSERT INTO users (username, password, role) VALUES ('admin', $1, 'admin')`, [hash]);
        console.log('✅ 已建立初始管理員帳號 admin / 123456');
    }

    // Seed built-in rooms if not exists
    const builtInRooms = ['Classroom 1', 'Classroom 2', 'VIP Room', 'EDS'];
    for (const rName of builtInRooms) {
        const check = await pool.query(`SELECT id FROM rooms WHERE name = $1`, [rName]);
        if (check.rows.length === 0) {
            await pool.query(`INSERT INTO rooms (name) VALUES ($1)`, [rName]);
        }
    }

    // Seed default employees if not exists
    const defaultEmps = ['Pius', 'Natalie', 'Erle', 'Ivy'];
    for (const eName of defaultEmps) {
        const check = await pool.query(`SELECT id FROM employees WHERE name = $1`, [eName]);
        if (check.rows.length === 0) {
            await pool.query(`INSERT INTO employees (name) VALUES ($1)`, [eName]);
        }
    }

    console.log('✅ 資料表初始化完成');
}

// ========== 登入 API ==========
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, msg: "請輸入帳號密碼" });
    try {
        const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
        if (result.rows.length === 0) return res.json({ ok: false, msg: "帳號不存在" });
        const user = result.rows[0];
        if (!bcrypt.compareSync(password, user.password)) return res.json({ ok: false, msg: "密碼錯誤" });
        res.json({ ok: true, data: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// ================================================================
//  預約 CRUD
// ================================================================

app.post('/api/reservations', async (req, res) => {
    const { date, name, employee, room, startTime, endTime } = req.body;
    if (!date || !name || !employee || !room || !startTime || !endTime) {
        return res.json({ ok: false, msg: "所有欄位皆為必填" });
    }
    try {
        const result = await pool.query(
            `INSERT INTO reservations (res_date, title, employee, room_name, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [date, name, employee, room, startTime, endTime]
        );
        const newId = result.rows[0].id;
        await logOperation('CREATE_RESERVATION', newId, `新增預約: ${date} ${startTime}-${endTime} ${name} [${employee}] ${room}`, req.ip, { date, name, employee, room, startTime, endTime });
        res.json({ ok: true, data: { id: newId } });
    } catch (err) {
        res.json({ ok: false, msg: "儲存失敗：" + err.message });
    }
});

app.get('/api/reservations', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, res_date as date, title as name, employee, room_name as room, start_time as "startTime", end_time as "endTime" FROM reservations WHERE is_deleted = 0 ORDER BY res_date, start_time`
        );
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.put('/api/reservations/:id', async (req, res) => {
    const id = req.params.id;
    const { date, name, employee, room, startTime, endTime } = req.body;
    if (!date || !name || !employee || !room || !startTime || !endTime) {
        return res.json({ ok: false, msg: "所有欄位皆為必填" });
    }
    try {
        const old = await pool.query(`SELECT * FROM reservations WHERE id = $1`, [id]);
        const result = await pool.query(
            `UPDATE reservations SET res_date=$1, title=$2, employee=$3, room_name=$4, start_time=$5, end_time=$6, update_at=CURRENT_TIMESTAMP WHERE id=$7 AND is_deleted=0 RETURNING id`,
            [date, name, employee, room, startTime, endTime, id]
        );
        if (result.rows.length === 0) return res.json({ ok: false, msg: "找不到該預約" });
        const oldData = old.rows[0] || {};
        await logOperation('UPDATE_RESERVATION', id, `更新預約 #${id}`, req.ip, { before: { date: oldData.res_date, name: oldData.title, employee: oldData.employee, room: oldData.room_name, startTime: oldData.start_time, endTime: oldData.end_time }, after: { date, name, employee, room, startTime, endTime } });
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: "更新失敗：" + err.message });
    }
});

app.delete('/api/reservations/batch/date/:date', async (req, res) => {
    const date = req.params.date;
    try {
        const result = await pool.query(
            `UPDATE reservations SET is_deleted = 1, update_at = CURRENT_TIMESTAMP WHERE res_date = $1 AND is_deleted = 0`, [date]
        );
        await logOperation('BATCH_DELETE_DATE', null, `批量刪除 ${date} 的 ${result.rowCount} 筆預約`, req.ip);
        res.json({ ok: true, deleted: result.rowCount });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.delete('/api/reservations/batch/month/:ym', async (req, res) => {
    const ym = req.params.ym;
    try {
        const result = await pool.query(
            `UPDATE reservations SET is_deleted = 1, update_at = CURRENT_TIMESTAMP WHERE res_date LIKE $1 AND is_deleted = 0`, [ym + '%']
        );
        await logOperation('BATCH_DELETE_MONTH', null, `批量刪除 ${ym} 月份的 ${result.rowCount} 筆預約`, req.ip);
        res.json({ ok: true, deleted: result.rowCount });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// 批量匯入預約（使用 transaction 修復 race condition）
app.post('/api/reservations/batch', async (req, res) => {
    const { list } = req.body;
    if (!Array.isArray(list) || list.length === 0) {
        return res.json({ ok: false, msg: "匯入清單為空" });
    }
    const client = await pool.connect();
    let successCount = 0;
    let failCount = 0;
    try {
        await client.query('BEGIN');
        for (const item of list) {
            try {
                await client.query(
                    `INSERT INTO reservations (res_date, title, employee, room_name, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [item.date, item.name, item.employee, item.room, item.startTime, item.endTime]
                );
                successCount++;
            } catch (e) {
                failCount++;
            }
        }
        await client.query('COMMIT');
        await logOperation('BATCH_IMPORT', null, `批量匯入: 成功 ${successCount} 條, 失敗 ${failCount} 條`, req.ip, { list: list.slice(0, 20) });
        res.json({ ok: true, success: successCount, fail: failCount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.json({ ok: false, msg: "批量匯入失敗：" + err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/reservations/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const old = await pool.query(`SELECT * FROM reservations WHERE id = $1`, [id]);
        const result = await pool.query(
            `UPDATE reservations SET is_deleted = 1, update_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]
        );
        if (result.rowCount === 0) return res.json({ ok: false, msg: "找不到該預約" });
        const d = old.rows[0];
        await logOperation('DELETE_RESERVATION', id, `刪除預約 #${id}: ${d?.res_date} ${d?.title}`, req.ip, { deleted: { date: d?.res_date, name: d?.title, employee: d?.employee, room: d?.room_name, startTime: d?.start_time, endTime: d?.end_time } });
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// ================================================================
//  房間 CRUD
// ================================================================

app.get('/api/rooms', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, name, short_name as short, color_data as "colorData" FROM rooms WHERE is_deleted = 0 ORDER BY name`);
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.get('/api/rooms/all', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, name, short_name as short, color_data as "colorData", is_deleted FROM rooms ORDER BY is_deleted, name`);
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.post('/api/rooms', async (req, res) => {
    const { name, short, colorData } = req.body;
    if (!name) return res.json({ ok: false, msg: "房間名稱不可空白" });
    try {
        const result = await pool.query(
            `INSERT INTO rooms (name, short_name, color_data) VALUES ($1, $2, $3) RETURNING id, name`,
            [name, short || '', colorData || '']
        );
        const r = result.rows[0];
        await logOperation('CREATE_ROOM', null, `新增房間: ${name}`, req.ip);
        res.json({ ok: true, data: { id: r.id, name: r.name, short: short || '', colorData: colorData || '' } });
    } catch (err) {
        if (err.message.includes('unique')) return res.json({ ok: false, msg: "房間名稱已存在" });
        res.json({ ok: false, msg: err.message });
    }
});

app.put('/api/rooms/:id/short', async (req, res) => {
    const id = req.params.id;
    const { short } = req.body;
    try {
        await pool.query(`UPDATE rooms SET short_name = $1 WHERE id = $2`, [short || '', id]);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.put('/api/rooms/:id/color', async (req, res) => {
    const id = req.params.id;
    const { colorData } = req.body;
    try {
        await pool.query(`UPDATE rooms SET color_data = $1 WHERE id = $2`, [colorData || '', id]);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.delete('/api/rooms/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const roomResult = await pool.query(`SELECT room_name FROM rooms WHERE id = $1`, [id]);
        if (roomResult.rows.length === 0) return res.json({ ok: false, msg: "找不到該房間" });
        const roomName = roomResult.rows[0].room_name;
        const cntResult = await pool.query(`SELECT COUNT(*) as cnt FROM reservations WHERE room_name = $1 AND is_deleted = 0`, [roomName]);
        if (parseInt(cntResult.rows[0].cnt) > 0) return res.json({ ok: false, msg: `房間「${roomName}」尚有 ${cntResult.rows[0].cnt} 筆預約，無法刪除` });
        await pool.query(`UPDATE rooms SET is_deleted = 1 WHERE id = $1`, [id]);
        await logOperation('DELETE_ROOM', null, `刪除房間: ${roomName}`, req.ip);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.put('/api/rooms/:id/restore', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query(`UPDATE rooms SET is_deleted = 0 WHERE id = $1`, [id]);
        if (result.rowCount === 0) return res.json({ ok: false, msg: "找不到該房間" });
        await logOperation('RESTORE_ROOM', null, `恢復房間 #${id}`, req.ip);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.delete('/api/rooms/:id/permanent', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query(`DELETE FROM rooms WHERE id = $1`, [id]);
        if (result.rowCount === 0) return res.json({ ok: false, msg: "找不到該房間" });
        await logOperation('PERMANENT_DELETE_ROOM', null, `永久刪除房間 #${id}`, req.ip);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.delete('/api/rooms/trash/empty', async (req, res) => {
    try {
        const result = await pool.query(`DELETE FROM rooms WHERE is_deleted = 1`);
        await logOperation('EMPTY_TRASH', null, `清空回收站: ${result.rowCount} 個房間`, req.ip);
        res.json({ ok: true, deleted: result.rowCount });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// ================================================================
//  員工 CRUD
// ================================================================

app.get('/api/employees', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, name FROM employees ORDER BY name`);
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.post('/api/employees', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.json({ ok: false, msg: "員工姓名不可空白" });
    try {
        const result = await pool.query(`INSERT INTO employees (name) VALUES ($1) RETURNING id, name`, [name]);
        const e = result.rows[0];
        await logOperation('CREATE_EMPLOYEE', null, `新增員工: ${name}`, req.ip);
        res.json({ ok: true, data: { id: e.id, name: e.name } });
    } catch (err) {
        if (err.message.includes('unique')) return res.json({ ok: false, msg: "員工已存在" });
        res.json({ ok: false, msg: err.message });
    }
});

app.delete('/api/employees/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await pool.query(`DELETE FROM employees WHERE id = $1`, [id]);
        if (result.rowCount === 0) return res.json({ ok: false, msg: "找不到該員工" });
        await logOperation('DELETE_EMPLOYEE', null, `刪除員工 #${id}`, req.ip);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// ================================================================
//  公告
// ================================================================

app.get('/api/announcement', async (req, res) => {
    try {
        const result = await pool.query(`SELECT content FROM announcement WHERE id = 1`);
        res.json({ ok: true, content: result.rows[0]?.content || "" });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

app.post('/api/announcement', async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query(`INSERT INTO announcement (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = $1, update_at = CURRENT_TIMESTAMP`, [content]);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// ================================================================
//  操作紀錄 API
// ================================================================

app.get('/api/logs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        const typeFilter = req.query.type || '';
        let sql = `SELECT id, operate_type as type, target_res_id as "targetId", content, detail, ip, create_at as "createAt" FROM operation_logs`;
        const params = [];
        if (typeFilter) {
            params.push(typeFilter);
            sql += ` WHERE operate_type = $${params.length}`;
        }
        sql += ` ORDER BY create_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const result = await pool.query(sql, params);

        const countResult = await pool.query(`SELECT COUNT(*) as total FROM operation_logs` + (typeFilter ? ` WHERE operate_type = $1` : ''), typeFilter ? [typeFilter] : []);

        res.json({ ok: true, data: result.rows, total: parseInt(countResult.rows[0].total) });
    } catch (err) {
        res.json({ ok: false, msg: err.message });
    }
});

// ================================================================
//  All other routes → serve index.html (SPA fallback)
// ================================================================
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== 啟動 ==========
initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 伺服器啟動：http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ 資料庫初始化失敗:', err.message);
    console.error('嘗試仍啟動伺服器（部分功能可能無法使用）...');
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`⚠️ 伺服器啟動（無 DB）：http://localhost:${PORT}`);
    });
});
