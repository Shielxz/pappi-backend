const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const db = require('../database');

const router = express.Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Solo archivos de imagen permitidos'));
    }
});

// ===== CATEGORIES =====

// GET categories by restaurant
router.get('/categories/:restaurantId', (req, res) => {
    db.all("SELECT * FROM categories WHERE restaurant_id = ? ORDER BY name", [req.params.restaurantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// CREATE category with image
router.post('/categories', upload.single('image'), (req, res) => {
    const { restaurant_id, name } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    const stmt = db.prepare("INSERT INTO categories (restaurant_id, name, image_path) VALUES (?, ?, ?)");
    stmt.run(restaurant_id, name, image_path, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: "Category created", categoryId: this.lastID, image_path });
    });
    stmt.finalize();
});

// UPDATE category
router.put('/categories/:id', upload.single('image'), (req, res) => {
    const { name } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    let query, params;
    if (image_path) {
        query = "UPDATE categories SET name = ?, image_path = ? WHERE id = ?";
        params = [name, image_path, req.params.id];
    } else {
        query = "UPDATE categories SET name = ? WHERE id = ?";
        params = [name, req.params.id];
    }

    const stmt = db.prepare(query);
    stmt.run(params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Category updated", image_path });
    });
    stmt.finalize();
});

// DELETE category
router.delete('/categories/:id', (req, res) => {
    db.run("DELETE FROM categories WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Category deleted" });
    });
});

// ===== RESTAURANTS =====

router.get('/restaurants', (req, res) => {
    db.all("SELECT * FROM restaurants", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/restaurants', (req, res) => {
    const { owner_id, name, description, category, image_url } = req.body;

    const stmt = db.prepare("INSERT INTO restaurants (owner_id, name, description, category, image_url) VALUES (?, ?, ?, ?, ?)");
    stmt.run(owner_id, name, description || '', category || 'Variado', image_url || '', function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: "Restaurant created", restaurantId: this.lastID });
    });
    stmt.finalize();
});

// ===== PRODUCTS =====

router.get('/products/:restaurantId', (req, res) => {
    db.all("SELECT * FROM products WHERE restaurant_id = ? ORDER BY category, name", [req.params.restaurantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET products by category
router.get('/products/category/:categoryId', (req, res) => {
    db.all("SELECT * FROM products WHERE category_id = ? ORDER BY name", [req.params.categoryId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/products', upload.single('image'), (req, res) => {
    const { restaurant_id, name, description, price, category_id } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    const stmt = db.prepare("INSERT INTO products (restaurant_id, name, description, price, image_path, category_id) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(restaurant_id, name, description || '', price, image_path, category_id, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: "Product created", productId: this.lastID });
    });
    stmt.finalize();
});

router.put('/products/:id', upload.single('image'), (req, res) => {
    const { name, description, price, category_id } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    let query, params;
    if (image_path) {
        query = "UPDATE products SET name = ?, description = ?, price = ?, image_path = ?, category_id = ? WHERE id = ?";
        params = [name, description || '', price, image_path, category_id, req.params.id];
    } else {
        query = "UPDATE products SET name = ?, description = ?, price = ?, category_id = ? WHERE id = ?";
        params = [name, description || '', price, category_id, req.params.id];
    }

    const stmt = db.prepare(query);
    stmt.run(params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Product updated" });
    });
    stmt.finalize();
});

router.delete('/products/:id', (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Product deleted" });
    });
});

// ===== RESTAURANTS =====

// GET all restaurants
router.get('/restaurants', (req, res) => {
    db.all("SELECT * FROM restaurants ORDER BY name", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// UPDATE restaurant
router.put('/restaurants/:id', upload.single('image'), (req, res) => {
    const { name, description, category } = req.body;
    const restaurantId = req.params.id;

    let updates = [];
    let params = [];

    if (name) {
        updates.push('name = ?');
        params.push(name);
    }
    if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
    }
    if (category) {
        updates.push('category = ?');
        params.push(category);
    }
    if (req.body.lat) {
        updates.push('lat = ?');
        params.push(Number(req.body.lat));
    }
    if (req.body.lng) {
        updates.push('lng = ?');
        params.push(Number(req.body.lng));
    }
    if (req.file) {
        updates.push('image_url = ?');
        params.push(`/uploads/${req.file.filename}`);
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(restaurantId);

    const sql = `UPDATE restaurants SET ${updates.join(', ')} WHERE id = ?`;

    db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT * FROM restaurants WHERE id = ?", [restaurantId], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(row);
        });
    });
});

module.exports = router;
