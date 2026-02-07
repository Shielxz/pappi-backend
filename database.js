const { createClient } = require("@libsql/client");
const bcrypt = require('bcryptjs');

// TURSO CREDENTIALS
// TODO: Move these to Environment Variables in Render for security!
const url = "libsql://pappi-db-shielxz.aws-us-east-1.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3Njk5NzYxMTksImlkIjoiOTg1NzliNGYtYWYwYi00YTg4LTk5OTQtNGFkMTM1NjEyOWYxIiwicmlkIjoiODIwOWFkYTktNDNjZC00ZWZmLWFiNWEtMTM2NzBhYTRjOGMzIn0.Robz4gyxYJnElcZM7oXjs-nA1m9dvfxA4pr0FoXoxsdyPiHzUvA8vcnoIx1DqxS0r7zyvxqCu9A_9x4GTWHZBw";

const client = createClient({
    url,
    authToken,
});

console.log("🚀 Connecting to Turso Cloud Database...");

// Wrapper to mimic sqlite3 API for existing routes
const db = {
    serialize: (cb) => { if (cb) cb(); }, // No-op in promise-land
    run: async function (sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        try {
            const result = await client.execute({ sql, args: params || [] });
            if (callback) {
                // Emulate 'this' context for changes/lastID
                const context = {
                    lastID: result.lastInsertRowid ? result.lastInsertRowid.toString() : 0,
                    changes: result.rowsAffected
                };
                callback.call(context, null);
            }
        } catch (e) {
            console.error("DB RUN ERROR:", e.message, "SQL:", sql);
            if (callback) callback(e);
        }
    },
    all: async function (sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        try {
            const result = await client.execute({ sql, args: params || [] });
            if (callback) callback(null, result.rows);
        } catch (e) {
            console.error("DB ALL ERROR:", e.message, "SQL:", sql);
            if (callback) callback(e);
        }
    },
    get: async function (sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        try {
            const result = await client.execute({ sql, args: params || [] });
            if (callback) callback(null, result.rows[0]);
        } catch (e) {
            console.error("DB GET ERROR:", e.message, "SQL:", sql);
            if (callback) callback(e);
        }
    },
    // Shim for db.prepare() used in auth.js
    prepare: function (sql) {
        return {
            run: async function (...args) {
                const callback = args[args.length - 1];
                const params = args.slice(0, args.length - 1);
                return db.run(sql, params, callback);
            },
            finalize: function () {
                // No-op for LibSQL as there's no prepared statement state to clean up client-side
            }
        };
    }
};

// INITIALIZATION (Async)
async function initDB() {
    try {
        console.log("🛠️ Initializing Cloud Database Schema...");

        // 1. Users
        await client.execute(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'client',
            phone TEXT,
            push_token TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            email_verified INTEGER DEFAULT 0,
            phone_verified INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING_VERIFICATION' /* Although now we use pending table, legacy users might still be here */
        )`);

        // 1.5 Pending Registrations (Temporary Holding Area)
        await client.execute(`CREATE TABLE IF NOT EXISTS pending_registrations (
            email TEXT PRIMARY KEY,
            name TEXT,
            password TEXT,
            role TEXT,
            phone TEXT,
            restaurant_name TEXT,
            verification_code_email TEXT,
            verification_code_sms TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        try { await client.execute("ALTER TABLE users ADD COLUMN phone TEXT"); } catch (e) { }
        try { await client.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0"); } catch (e) { }
        try { await client.execute("ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0"); } catch (e) { }
        try { await client.execute("ALTER TABLE users ADD COLUMN verification_code_email TEXT"); } catch (e) { }
        try { await client.execute("ALTER TABLE users ADD COLUMN verification_code_sms TEXT"); } catch (e) { }
        try { await client.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'ACTIVE'"); } catch (e) { }

        // 2. Restaurants
        await client.execute(`CREATE TABLE IF NOT EXISTS restaurants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            name TEXT,
            description TEXT,
            category TEXT,
            image_url TEXT,
            rating REAL DEFAULT 5.0,
            lat REAL,
            lng REAL,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        )`);
        try { await client.execute("ALTER TABLE restaurants ADD COLUMN lat REAL"); } catch (e) { }
        try { await client.execute("ALTER TABLE restaurants ADD COLUMN lng REAL"); } catch (e) { }


        // 3. Products
        await client.execute(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER,
            name TEXT,
            description TEXT,
            price REAL,
            image_url TEXT,
            is_available INTEGER DEFAULT 1,
            category_id INTEGER,
            FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
        )`);
        try { await client.execute("ALTER TABLE products ADD COLUMN category_id INTEGER"); } catch (e) { }

        // MIGRATION: Rename image_url to image_path for consistency with categories
        try {
            await client.execute("ALTER TABLE products RENAME COLUMN image_url TO image_path");
            console.log("✅ Migrated products.image_url → image_path");
        } catch (e) { }

        // MIGRATION: Soft Delete support
        try {
            await client.execute("ALTER TABLE products ADD COLUMN is_deleted INTEGER DEFAULT 0");
            console.log("✅ Added products.is_deleted");
        } catch (e) { }


        // 4. Orders
        await client.execute(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER,
            driver_id INTEGER,
            restaurant_id INTEGER,
            status TEXT,
            total_price REAL,
            delivery_address TEXT,
            delivery_lat REAL,
            delivery_lng REAL,
            driver_name TEXT,
            estimated_time INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(client_id) REFERENCES users(id),
            FOREIGN KEY(driver_id) REFERENCES users(id),
            FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
        )`);

        // 5. Order Items
        await client.execute(`CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            product_id INTEGER,
            quantity INTEGER,
            price_at_time REAL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )`);

        // 6. Categories
        await client.execute(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id INTEGER,
            name TEXT,
            image_path TEXT,
            FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
        )`);

        console.log("✅ Tables Synced.");

        // SEED SUPER ADMIN
        const adminEmail = "superpappi@admin.com";
        const usersRS = await client.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [adminEmail] });

        if (usersRS.rows.length === 0) {
            console.log("🌱 Seeding Super Admin...");
            const hash = await bcrypt.hash("pappimaestro", 10);
            await client.execute({
                sql: `INSERT INTO users (name, email, password, phone, role, status) VALUES (?, ?, ?, ?, ?, ?)`,
                args: ["Super Pappi", adminEmail, hash, "0000000000", "superadmin", "ACTIVE"]
            });
            console.log("👑 Super Admin Created.");
        } else {
            console.log("👌 Super Admin already exists.");
        }

    } catch (e) {
        console.error("❌ Database Init Error:", e);
    }
}

// Start Init
initDB();

module.exports = db;
