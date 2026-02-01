const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

const router = express.Router();
const JWT_SECRET = 'pappi_secret_key_123'; // In production, use env var

// REGISTER
// REGISTER V2 (Advanced with Verification)
router.post('/register-v2', (req, res) => {
    const { name, email, password, role, phone, restaurantName } = req.body;

    if (!name || !email || !password || !phone) {
        return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const validRole = ['client', 'driver', 'admin', 'superadmin'].includes(role) ? role : 'client';

    // Mock Codes
    const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
    const smsCode = Math.floor(100000 + Math.random() * 900000).toString();

    const status = 'PENDING_VERIFICATION';

    const stmt = db.prepare("INSERT INTO users (name, email, password, role, phone, verification_code_email, verification_code_sms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(name, email, hash, validRole, phone, emailCode, smsCode, status, function (err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(400).json({ error: "El correo ya está registrado" });
            }
            return res.status(500).json({ error: err.message });
        }

        const userId = this.lastID;
        console.log(`\n📧 [MOCK EMAIL] Para: ${email} | Código: ${emailCode}`);
        console.log(`📱 [MOCK SMS] Para: ${phone} | Código: ${smsCode}\n`);

        // If admin, create restaurant placeholder
        if (validRole === 'admin' && restaurantName) {
            const restStmt = db.prepare("INSERT INTO restaurants (owner_id, name, description, category) VALUES (?, ?, 'Restaurante Nuevo', 'General')");
            restStmt.run(userId, restaurantName);
            restStmt.finalize();
        }

        res.status(201).json({ message: "Usuario creado. Verifique códigos.", userId, status, emailCode, smsCode });
    });
    stmt.finalize();
});

// VERIFY ACCOUNT
router.post('/verify', (req, res) => {
    const { userId, emailCode, smsCode } = req.body;

    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "Usuario no encontrado" });

        if (user.verification_code_email !== emailCode) {
            return res.status(400).json({ error: "Código de Email incorrecto" });
        }
        if (user.verification_code_sms !== smsCode) {
            return res.status(400).json({ error: "Código SMS incorrecto" });
        }

        // Success - Move to PENDING_APPROVAL
        const newStatus = 'PENDING_APPROVAL';
        db.run("UPDATE users SET status = ?, email_verified = 1, phone_verified = 1 WHERE id = ?", [newStatus, userId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Cuenta verificada. Esperando aprobación del administrador.", status: newStatus });
        });
    });
});


// LOGIN
// LOGIN
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        const isValid = bcrypt.compareSync(password, user.password);
        if (!isValid) return res.status(401).json({ error: "Contraseña incorrecta" });

        // Status Checks
        if (user.status === 'PENDING_VERIFICATION') {
            return res.status(403).json({ error: "Cuenta no verificada", code: 'NOT_VERIFIED', userId: user.id });
        }
        if (user.status === 'PENDING_APPROVAL') {
            return res.status(403).json({ error: "Cuenta en revisión por el administrador", code: 'PENDING_APPROVAL' });
        }
        if (user.status === 'REJECTED') {
            return res.status(403).json({ error: "Su solicitud ha sido rechazada. Contacte soporte.", code: 'REJECTED' });
        }
        // If status is null (legacy user), allow login or force update? 
        // For now, treat null as ACTIVE or migrate DB properly. 
        // Assuming DB migration set default 'ACTIVE' for old users.

        // Generate Token
        const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            message: "Login successful",
            token,
            user: { id: user.id, name: user.name, role: user.role, status: user.status }
        });
    });
});


// UPDATE PUSH TOKEN
router.post('/update-push-token', (req, res) => {
    const { userId, pushToken } = req.body;
    if (!userId || !pushToken) return res.status(400).json({ error: "Missing data" });

    db.run("UPDATE users SET push_token = ? WHERE id = ?", [pushToken, userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Token updated" });
    });
});

// SUPER ADMIN ROUTES (Protected in prod, open for demo)
router.get('/pending', (req, res) => {
    db.all("SELECT users.id, users.name, users.email, users.phone, users.role, restaurants.name as restaurant_name FROM users LEFT JOIN restaurants ON users.id = restaurants.owner_id WHERE users.status = 'PENDING_APPROVAL'", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/approve', (req, res) => {
    const { userId } = req.body;
    db.run("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Usuario aprobado y activado" });
    });
});

router.post('/reject', (req, res) => {
    const { userId } = req.body;
    db.run("UPDATE users SET status = 'REJECTED' WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Usuario rechazado" });
    });
});

// TEMPORARY: Promote to Super Admin (Hidden Route)
router.post('/promote-super-secret', (req, res) => {
    const { userId, secret } = req.body;
    if (secret !== 'pappi-master-key-2024') return res.status(403).json({ error: "Forbidden" });

    db.run("UPDATE users SET role = 'superadmin', status = 'ACTIVE' WHERE id = ?", [userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "User promoted to SUPERADMIN" });
    });
});

module.exports = router;
