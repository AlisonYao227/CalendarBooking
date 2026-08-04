const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

console.log('🔧 PORT:', PORT);
console.log('🔧 DATABASE_URL set:', !!DATABASE_URL);
console.log('🔧 NODE_VERSION:', process.version);

const pool = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
}) : null;

if (pool) {
    pool.on('error', (err) => {
        console.error('⚠️ PG idle client error:', err.message);
    });
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api', (req, res) => {
    res.json({ ok: true, message: "Calendar Booking API" });
});

async function query(sql, params) {
    if (!pool) throw new Error('No database configured');
    return pool.query(sql, params);
}

async function initDB() {
    if (!pool) { console.log('⚠️ 無 DB，跳過初始化'); return; }
    await query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','admin')), create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, short_name TEXT DEFAULT '',
        color_data TEXT DEFAULT '', is_deleted INTEGER DEFAULT 0, create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY, res_date TEXT NOT NULL, title TEXT NOT NULL,
        employee TEXT NOT NULL, room_name TEXT NOT NULL, start_time TEXT NOT NULL,
        end_time TEXT NOT NULL, creator_id INTEGER, is_deleted INTEGER DEFAULT 0,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS end_date TEXT;`);
    await query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '';`);
    await query(`CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`CREATE TABLE IF NOT EXISTS announcement (
        id INTEGER PRIMARY KEY DEFAULT 1, content TEXT, update_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`CREATE TABLE IF NOT EXISTS operation_logs (
        id SERIAL PRIMARY KEY, operate_type TEXT NOT NULL, target_res_id INTEGER,
        content TEXT, detail TEXT, ip TEXT, create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`CREATE TABLE IF NOT EXISTS todos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        start_time TEXT DEFAULT '',
        end_time TEXT DEFAULT '',
        room_name TEXT DEFAULT '',
        employee TEXT DEFAULT '',
        is_all_day INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`ALTER TABLE todos ADD COLUMN IF NOT EXISTS start_time TEXT DEFAULT ''`);
    await query(`ALTER TABLE todos ADD COLUMN IF NOT EXISTS end_time TEXT DEFAULT ''`);
    await query(`CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        holiday_date TEXT NOT NULL,
        name TEXT NOT NULL,
        name_en TEXT DEFAULT '',
        year INTEGER NOT NULL,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(holiday_date)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS employee_leaves (
        id SERIAL PRIMARY KEY,
        employee TEXT NOT NULL,
        leave_date TEXT NOT NULL,
        end_date TEXT DEFAULT '',
        leave_type TEXT DEFAULT '',
        is_deleted INTEGER DEFAULT 0,
        create_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS end_date TEXT DEFAULT ''`);

    const adminCheck = await query(`SELECT id FROM users WHERE username = 'admin'`);
    if (adminCheck.rows.length === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        await query(`INSERT INTO users (username, password, role) VALUES ('admin', $1, 'admin')`, [hash]);
    }
    const builtInRooms = ['VIP Room', 'EDS'];
    for (const rName of builtInRooms) {
        const check = await query(`SELECT id FROM rooms WHERE name = $1`, [rName]);
        if (check.rows.length === 0) await query(`INSERT INTO rooms (name) VALUES ($1)`, [rName]);
    }
    const defaultEmps = ['Pius', 'Natalie', 'Erle', 'Ivy'];
    for (const eName of defaultEmps) {
        const check = await query(`SELECT id FROM employees WHERE name = $1`, [eName]);
        if (check.rows.length === 0) await query(`INSERT INTO employees (name) VALUES ($1)`, [eName]);
    }
    console.log('✅ DB 初始化完成');
}

async function logOp(type, resId, content, ip, detail) {
    if (!pool) return;
    try {
        await query(`INSERT INTO operation_logs (operate_type, target_res_id, content, ip, detail) VALUES ($1,$2,$3,$4,$5)`,
            [type, resId || null, content, ip || '', detail ? JSON.stringify(detail) : null]);
    } catch (e) { console.error('log寫入失敗:', e.message); }
}

// === Login ===
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, msg: "請輸入帳號密碼" });
    try {
        const r = await query(`SELECT * FROM users WHERE username = $1`, [username]);
        if (r.rows.length === 0) return res.json({ ok: false, msg: "帳號不存在" });
        const user = r.rows[0];
        if (!bcrypt.compareSync(password, user.password)) return res.json({ ok: false, msg: "密碼錯誤" });
        res.json({ ok: true, data: { id: user.id, username: user.username, role: user.role } });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Reservations ===
app.post('/api/reservations', async (req, res) => {
    const { date, name, employee, room, startTime, endTime, endDate, note } = req.body;
    if (!date || !name || !employee || !room || !startTime || !endTime) return res.json({ ok: false, msg: "所有欄位皆為必填" });
    try {
        const newEnd = endDate || date;
        const conflict = await query(
            `SELECT id, employee FROM reservations WHERE room_name=$1 AND is_deleted=0
             AND (res_date || ' ' || start_time)::timestamp < ($2 || ' ' || $3)::timestamp
             AND ($4 || ' ' || $5)::timestamp < (end_date || ' ' || end_time)::timestamp`,
            [room, newEnd, endTime, date, startTime]
        );
        if (conflict.rows.length > 0) {
            return res.json({ ok: false, msg: `該時段已被 ${conflict.rows[0].employee} 預約` });
        }
        const r = await query(`INSERT INTO reservations (res_date,title,employee,room_name,start_time,end_time,end_date,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [date, name, employee, room, startTime, endTime, endDate || date, note || '']);
        const id = r.rows[0].id;
        await logOp('CREATE_RESERVATION', id, `新增: ${date} ${startTime}-${endTime} ${name} [${employee}] ${room}`, req.ip, { date, name, employee, room, startTime, endTime, note });
        res.json({ ok: true, data: { id } });
    } catch (err) { res.json({ ok: false, msg: "儲存失敗：" + err.message }); }
});

app.get('/api/reservations', async (req, res) => {
    try {
        const r = await query(`SELECT id, res_date as date, title as name, employee, room_name as room, start_time as "startTime", end_time as "endTime", end_date as "endDate", note FROM reservations WHERE is_deleted=0 ORDER BY res_date, start_time`);
        res.json({ ok: true, data: r.rows });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.put('/api/reservations/:id', async (req, res) => {
    const id = req.params.id;
    const { date, name, employee, room, startTime, endTime, endDate, note } = req.body;
    if (!date || !name || !employee || !room || !startTime || !endTime) return res.json({ ok: false, msg: "所有欄位皆為必填" });
    try {
        const old = await query(`SELECT * FROM reservations WHERE id=$1`, [id]);
        const newEnd = endDate || date;
        const conflict = await query(
            `SELECT id, employee FROM reservations WHERE room_name=$1 AND is_deleted=0 AND id!=$2
             AND (res_date || ' ' || start_time)::timestamp < ($3 || ' ' || $4)::timestamp
             AND ($5 || ' ' || $6)::timestamp < (end_date || ' ' || end_time)::timestamp`,
            [room, id, newEnd, endTime, date, startTime]
        );
        if (conflict.rows.length > 0) {
            return res.json({ ok: false, msg: `該時段已被 ${conflict.rows[0].employee} 預約` });
        }
        const r = await query(`UPDATE reservations SET res_date=$1,title=$2,employee=$3,room_name=$4,start_time=$5,end_time=$6,end_date=$7,note=$8,update_at=CURRENT_TIMESTAMP WHERE id=$9 AND is_deleted=0 RETURNING id`, [date, name, employee, room, startTime, endTime, endDate || date, note || '', id]);
        if (r.rows.length === 0) return res.json({ ok: false, msg: "找不到該預約" });
        const d = old.rows[0] || {};
        await logOp('UPDATE_RESERVATION', id, `更新 #${id}`, req.ip, { before: { date: d.res_date, name: d.title, employee: d.employee, room: d.room_name, startTime: d.start_time, endTime: d.end_time, note: d.note }, after: { date, name, employee, room, startTime, endTime, note } });
        res.json({ ok: true });
    } catch (err) { res.json({ ok: false, msg: "更新失敗：" + err.message }); }
});

app.delete('/api/reservations/batch/date/:date', async (req, res) => {
    try {
        const r = await query(`UPDATE reservations SET is_deleted=1,update_at=CURRENT_TIMESTAMP WHERE (res_date=$1 OR end_date=$1) AND is_deleted=0`, [req.params.date]);
        await logOp('BATCH_DELETE_DATE', null, `批量刪除 ${req.params.date} 的 ${r.rowCount} 筆`, req.ip);
        res.json({ ok: true, deleted: r.rowCount });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.delete('/api/reservations/batch/month/:ym', async (req, res) => {
    try {
        const r = await query(`UPDATE reservations SET is_deleted=1,update_at=CURRENT_TIMESTAMP WHERE res_date LIKE $1 AND is_deleted=0`, [req.params.ym + '%']);
        await logOp('BATCH_DELETE_MONTH', null, `批量刪除 ${req.params.ym} 月份 ${r.rowCount} 筆`, req.ip);
        res.json({ ok: true, deleted: r.rowCount });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/reservations/batch', async (req, res) => {
    const { list } = req.body;
    if (!Array.isArray(list) || list.length === 0) return res.json({ ok: false, msg: "匯入清單為空" });
    const client = pool ? await pool.connect() : null;
    let ok = 0, fail = 0;
    const failDetails = [];
    try {
        if (client) await client.query('BEGIN');
        for (const item of list) {
            try {
                if (client) {
                    const itemEnd = item.endDate || item.date;
                    const conflict = await client.query(
                        `SELECT employee FROM reservations WHERE room_name=$1 AND is_deleted=0
                         AND (res_date || ' ' || start_time)::timestamp < ($2 || ' ' || $3)::timestamp
                         AND ($4 || ' ' || $5)::timestamp < (end_date || ' ' || end_time)::timestamp`,
                        [item.room, itemEnd, item.endTime, item.date, item.startTime]
                    );
                    if (conflict.rows.length > 0) { fail++; failDetails.push(`第${item.row||'?'}行「${item.name}」${item.date} ${item.startTime}-${item.endTime} ${item.room} 時段已被 ${conflict.rows[0].employee} 預約`); continue; }
                    await client.query(`INSERT INTO reservations (res_date,title,employee,room_name,start_time,end_time,end_date,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [item.date, item.name, item.employee, item.room, item.startTime, item.endTime, item.endDate || item.date, item.note || '']);
                    ok++;
                } else {
                    ok++;
                }
            } catch (e) { fail++; failDetails.push(`第${item.row||'?'}行「${item.name}」${item.date}: ${e.message}`); }
        }
        if (client) await client.query('COMMIT');
        await logOp('BATCH_IMPORT', null, `匯入: 成功${ok} 失敗${fail}`, req.ip);
        res.json({ ok: true, success: ok, fail, failDetails });
    } catch (err) { if (client) await client.query('ROLLBACK'); res.json({ ok: false, msg: err.message }); }
    finally { if (client) client.release(); }
});

app.delete('/api/reservations/:id', async (req, res) => {
    try {
        const old = await query(`SELECT * FROM reservations WHERE id=$1`, [req.params.id]);
        const r = await query(`UPDATE reservations SET is_deleted=1,update_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
        if (r.rowCount === 0) return res.json({ ok: false, msg: "找不到" });
        const d = old.rows[0];
        await logOp('DELETE_RESERVATION', req.params.id, `刪除 #${req.params.id}: ${d?.res_date} ${d?.title}`, req.ip);
        res.json({ ok: true });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Rooms ===
app.get('/api/rooms', async (req, res) => {
    try { const r = await query(`SELECT id,name,short_name as short,color_data as "colorData" FROM rooms WHERE is_deleted=0 ORDER BY name`); res.json({ ok: true, data: r.rows }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.get('/api/rooms/all', async (req, res) => {
    try { const r = await query(`SELECT id,name,short_name as short,color_data as "colorData",is_deleted FROM rooms ORDER BY is_deleted,name`); res.json({ ok: true, data: r.rows }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.post('/api/rooms', async (req, res) => {
    const { name, short, colorData } = req.body;
    if (!name) return res.json({ ok: false, msg: "房間名稱不可空白" });
    try { const r = await query(`INSERT INTO rooms (name,short_name,color_data) VALUES ($1,$2,$3) RETURNING id,name`, [name, short||'', colorData||'']); await logOp('CREATE_ROOM',null,`新增房間: ${name}`,req.ip); res.json({ ok: true, data: { id: r.rows[0].id, name: r.rows[0].name, short: short||'', colorData: colorData||'' } }); }
    catch (err) { if (err.message.includes('unique')) return res.json({ ok: false, msg: "房間名稱已存在" }); res.json({ ok: false, msg: err.message }); }
});
app.put('/api/rooms/:id/short', async (req, res) => {
    try { await query(`UPDATE rooms SET short_name=$1 WHERE id=$2`, [req.body.short||'', req.params.id]); res.json({ ok: true }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.put('/api/rooms/:id/color', async (req, res) => {
    try { await query(`UPDATE rooms SET color_data=$1 WHERE id=$2`, [req.body.colorData||'', req.params.id]); res.json({ ok: true }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.delete('/api/rooms/:id', async (req, res) => {
    try {
        const rm = await query(`SELECT name FROM rooms WHERE id=$1`, [req.params.id]);
        if (rm.rows.length === 0) return res.json({ ok: false, msg: "找不到" });
        const rn = rm.rows[0].name;
        const cnt = await query(`SELECT COUNT(*) as cnt FROM reservations WHERE room_name=$1 AND is_deleted=0`, [rn]);
        if (parseInt(cnt.rows[0].cnt) > 0) return res.json({ ok: false, msg: `尚有 ${cnt.rows[0].cnt} 筆預約` });
        await query(`UPDATE rooms SET is_deleted=1 WHERE id=$1`, [req.params.id]);
        await logOp('DELETE_ROOM',null,`刪除房間: ${rn}`,req.ip);
        res.json({ ok: true });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.put('/api/rooms/:id/restore', async (req, res) => {
    try { const r = await query(`UPDATE rooms SET is_deleted=0 WHERE id=$1`, [req.params.id]); if (r.rowCount===0) return res.json({ok:false,msg:"找不到"}); await logOp('RESTORE_ROOM',null,`恢復 #${req.params.id}`,req.ip); res.json({ok:true}); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.delete('/api/rooms/:id/permanent', async (req, res) => {
    try { const r = await query(`DELETE FROM rooms WHERE id=$1`, [req.params.id]); if (r.rowCount===0) return res.json({ok:false,msg:"找不到"}); await logOp('PERMANENT_DELETE_ROOM',null,`永久刪除 #${req.params.id}`,req.ip); res.json({ok:true}); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.delete('/api/rooms/trash/empty', async (req, res) => {
    try { const r = await query(`DELETE FROM rooms WHERE is_deleted=1`); await logOp('EMPTY_TRASH',null,`清空回收站 ${r.rowCount} 個`,req.ip); res.json({ok:true,deleted:r.rowCount}); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Employees ===
app.get('/api/employees', async (req, res) => {
    try { const r = await query(`SELECT id,name FROM employees ORDER BY name`); res.json({ ok: true, data: r.rows }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.post('/api/employees', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.json({ ok: false, msg: "姓名不可空白" });
    try { const r = await query(`INSERT INTO employees (name) VALUES ($1) RETURNING id,name`, [name]); await logOp('CREATE_EMPLOYEE',null,`新增員工: ${name}`,req.ip); res.json({ ok: true, data: r.rows[0] }); }
    catch (err) { if (err.message.includes('unique')) return res.json({ ok: false, msg: "員工已存在" }); res.json({ ok: false, msg: err.message }); }
});
app.delete('/api/employees/:id', async (req, res) => {
    try { const r = await query(`DELETE FROM employees WHERE id=$1`, [req.params.id]); if (r.rowCount===0) return res.json({ok:false,msg:"找不到"}); await logOp('DELETE_EMPLOYEE',null,`刪除 #${req.params.id}`,req.ip); res.json({ok:true}); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Announcement ===
app.get('/api/announcement', async (req, res) => {
    try { const r = await query(`SELECT content FROM announcement WHERE id=1`); res.json({ ok: true, content: r.rows[0]?.content || "" }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});
app.post('/api/announcement', async (req, res) => {
    try { await query(`INSERT INTO announcement (id,content) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET content=$1,update_at=CURRENT_TIMESTAMP`, [req.body.content]); res.json({ ok: true }); }
    catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Todos ===
app.get('/api/todos', async (req, res) => {
    try {
        const r = await query(`SELECT id, title, start_date as "startDate", end_date as "endDate", start_time as "startTime", end_time as "endTime", room_name as "room", employee, is_all_day as "isAllDay" FROM todos WHERE is_deleted=0 ORDER BY start_date`);
        res.json({ ok: true, data: r.rows });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/todos', async (req, res) => {
    const { title, startDate, endDate, startTime, endTime, room, employee, isAllDay } = req.body;
    if (!title || !startDate || !endDate) return res.json({ ok: false, msg: "標題、開始日期、結束日期為必填" });
    try {
        const r = await query(`INSERT INTO todos (title,start_date,end_date,start_time,end_time,room_name,employee,is_all_day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [title, startDate, endDate, startTime||'', endTime||'', room||'', employee||'', isAllDay ? 1 : 0]);
        res.json({ ok: true, data: { id: r.rows[0].id } });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.put('/api/todos/:id', async (req, res) => {
    const { title, startDate, endDate, startTime, endTime, room, employee, isAllDay } = req.body;
    try {
        const r = await query(`UPDATE todos SET title=$1,start_date=$2,end_date=$3,start_time=$4,end_time=$5,room_name=$6,employee=$7,is_all_day=$8 WHERE id=$9 AND is_deleted=0 RETURNING id`, [title, startDate, endDate, startTime||'', endTime||'', room||'', employee||'', isAllDay ? 1 : 0, req.params.id]);
        if (r.rows.length === 0) return res.json({ ok: false, msg: "找不到" });
        res.json({ ok: true });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.delete('/api/todos/:id', async (req, res) => {
    try {
        const r = await query(`UPDATE todos SET is_deleted=1 WHERE id=$1`, [req.params.id]);
        if (r.rowCount === 0) return res.json({ ok: false, msg: "找不到" });
        res.json({ ok: true });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/todos/batch-delete', async (req, res) => {
    const { title, startTime, endTime, room, employee, isAllDay } = req.body;
    try {
        const r = await query(
            `DELETE FROM todos WHERE title=$1 AND COALESCE(start_time,'')=$2 AND COALESCE(end_time,'')=$3 AND COALESCE(room,'')=$4 AND COALESCE(employee,'')=$5 AND is_all_day=$6`,
            [title, startTime || '', endTime || '', room || '', employee || '', isAllDay ? 1 : 0]
        );
        res.json({ ok: true, deleted: r.rowCount });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/todos/batch-delete-by-ids', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.json({ ok: false, msg: "ids required" });
    try {
        const r = await query(`DELETE FROM todos WHERE id = ANY($1)`, [ids]);
        res.json({ ok: true, deleted: r.rowCount });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Holidays (Nager.Date proxy + DB cache) ===
app.get('/api/holidays', async (req, res) => {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    try {
        // Check DB cache first
        const cached = await query(`SELECT holiday_date as date, name, name_en FROM holidays WHERE year = $1 ORDER BY holiday_date`, [year]);
        if (cached.rows.length > 0) return res.json({ ok: true, data: cached.rows, source: 'cache' });

        // Fetch from Nager.Date
        const nagerRes = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/HK`);
        if (!nagerRes.ok) throw new Error(`Nager.Date returned ${nagerRes.status}`);
        const holidays = await nagerRes.json();

        // Save to DB
        for (const h of holidays) {
            await query(
                `INSERT INTO holidays (holiday_date, name, name_en, year) VALUES ($1, $2, $3, $4) ON CONFLICT (holiday_date) DO UPDATE SET name = $2, name_en = $3`,
                [h.date, h.localName || h.name, h.name, year]
            );
        }

        const result = await query(`SELECT holiday_date as date, name, name_en FROM holidays WHERE year = $1 ORDER BY holiday_date`, [year]);
        res.json({ ok: true, data: result.rows, source: 'nager' });
    } catch (err) {
        console.error('Holidays fetch error:', err.message);
        // Try to return whatever is in cache even if partial
        try {
            const fallback = await query(`SELECT holiday_date as date, name, name_en FROM holidays WHERE year = $1 ORDER BY holiday_date`, [year]);
            res.json({ ok: true, data: fallback.rows, source: 'cache-fallback' });
        } catch (e2) {
            res.json({ ok: false, msg: err.message });
        }
    }
});

// === Employee Leaves ===
app.get('/api/employee-leaves', async (req, res) => {
    try {
        const r = await query(`SELECT id, employee, leave_date as "leaveDate", COALESCE(end_date,'') as "endDate", leave_type as "leaveType" FROM employee_leaves WHERE is_deleted=0 ORDER BY leave_date`);
        res.json({ ok: true, data: r.rows });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/employee-leaves', async (req, res) => {
    const { employee, leaveDate, endDate, leaveType } = req.body;
    if (!employee || !leaveDate) return res.json({ ok: false, msg: "員工姓名和日期為必填" });
    const finalEndDate = endDate || leaveDate;
    try {
        const r = await query(`INSERT INTO employee_leaves (employee, leave_date, end_date, leave_type) VALUES ($1,$2,$3,$4) RETURNING id`, [employee, leaveDate, finalEndDate, leaveType || '']);
        await logOp('CREATE_LEAVE', r.rows[0].id, `新增假期: ${employee} ${leaveDate}${finalEndDate !== leaveDate ? ' ~ ' + finalEndDate : ''}`, req.ip);
        res.json({ ok: true, data: { id: r.rows[0].id } });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/employee-leaves/batch', async (req, res) => {
    const { list } = req.body;
    if (!Array.isArray(list) || list.length === 0) return res.json({ ok: false, msg: "匯入清單為空" });
    const client = pool ? await pool.connect() : null;
    let ok = 0, fail = 0;
    try {
        if (client) await client.query('BEGIN');
        for (const item of list) {
            try {
                const finalEndDate = item.endDate || item.leaveDate;
                if (client) {
                    await client.query(`INSERT INTO employee_leaves (employee, leave_date, end_date, leave_type) VALUES ($1,$2,$3,$4)`, [item.employee, item.leaveDate, finalEndDate, item.leaveType || '']);
                    ok++;
                } else {
                    ok++;
                }
            } catch (e) { fail++; }
        }
        if (client) await client.query('COMMIT');
        await logOp('BATCH_IMPORT_LEAVES', null, `匯入員工假期: 成功${ok} 失敗${fail}`, req.ip);
        res.json({ ok: true, success: ok, fail });
    } catch (err) { if (client) await client.query('ROLLBACK'); res.json({ ok: false, msg: err.message }); }
    finally { if (client) client.release(); }
});

app.delete('/api/employee-leaves/:id', async (req, res) => {
    try {
        const r = await query(`UPDATE employee_leaves SET is_deleted=1 WHERE id=$1`, [req.params.id]);
        if (r.rowCount === 0) return res.json({ ok: false, msg: "找不到" });
        await logOp('DELETE_LEAVE', req.params.id, `刪除假期 #${req.params.id}`, req.ip);
        res.json({ ok: true });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

app.post('/api/employee-leaves/batch-delete-by-ids', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.json({ ok: false, msg: "ids required" });
    try {
        const r = await query(`UPDATE employee_leaves SET is_deleted=1 WHERE id = ANY($1)`, [ids]);
        res.json({ ok: true, deleted: r.rowCount });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Logs ===
app.get('/api/logs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        const typeFilter = req.query.type || '';
        let sql = `SELECT id,operate_type as type,target_res_id as "targetId",content,detail,ip,create_at as "createAt" FROM operation_logs`;
        const params = [];
        if (typeFilter) { params.push(typeFilter); sql += ` WHERE operate_type=$${params.length}`; }
        sql += ` ORDER BY create_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
        params.push(limit, offset);
        const r = await query(sql, params);
        const c = await query(`SELECT COUNT(*) as total FROM operation_logs` + (typeFilter ? ` WHERE operate_type=$1` : ''), typeFilter ? [typeFilter] : []);
        res.json({ ok: true, data: r.rows, total: parseInt(c.rows[0].total) });
    } catch (err) { res.json({ ok: false, msg: err.message }); }
});

// === Static files ===
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === Start ===
process.on('uncaughtException', (err) => { console.error('⚠️ uncaughtException:', err.message); });
process.on('unhandledRejection', (err) => { console.error('⚠️ unhandledRejection:', err?.message || err); });

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    initDB().catch(err => console.error('❌ DB init failed:', err.message));
});
