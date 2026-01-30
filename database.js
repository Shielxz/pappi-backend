const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to Database (Creates file if not exists)
const dbPath = path.resolve(__dirname, 'pappi.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to SQLite database at ' + dbPath);
    }
});

// Initialize Tables
db.serialize(() => {
    // 1. Users (Clients, Drivers, Admins)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT, -- Hashed
        role TEXT DEFAULT 'client', -- client, driver, admin
        phone TEXT,
        push_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        email_verified INTEGER DEFAULT 0,
        phone_verified INTEGER DEFAULT 0,
        verification_code_email TEXT,
        verification_code_sms TEXT,
        status TEXT DEFAULT 'PENDING_VERIFICATION' -- PENDING_VERIFICATION, PENDING_APPROVAL, ACTIVE
    )`);

    // Migraciones para usuarios existentes o DB vieja
    const addCol = (table, col, def) => {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`, (err) => {
            if (!err) console.log(`Columna ${col} agregada a ${table}`);
        });
    };

    addCol('users', 'phone', 'TEXT');
    addCol('users', 'email_verified', 'INTEGER DEFAULT 0');
    addCol('users', 'phone_verified', 'INTEGER DEFAULT 0');
    addCol('users', 'verification_code_email', 'TEXT');
    addCol('users', 'verification_code_sms', 'TEXT');
    addCol('users', 'status', "TEXT DEFAULT 'ACTIVE'"); // Default active for old users

    // 2. Restaurants
    db.run(`CREATE TABLE IF NOT EXISTS restaurants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER,
        name TEXT,
        description TEXT,
        category TEXT, -- Fast Food, Sushi, etc.
        image_url TEXT,
        rating REAL DEFAULT 5.0,
        lat REAL,
        lng REAL,
        FOREIGN KEY(owner_id) REFERENCES users(id)
    )`);

    // Intentar agregar columnas si ya existe la tabla (Migración simple)
    db.run("ALTER TABLE restaurants ADD COLUMN lat REAL", (err) => { if (!err) console.log("Columna lat agregada"); });
    db.run("ALTER TABLE restaurants ADD COLUMN lng REAL", (err) => { if (!err) console.log("Columna lng agregada"); });

    // 3. Products (Menu)
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        restaurant_id INTEGER,
        name TEXT,
        description TEXT,
        price REAL,
        image_url TEXT,
        is_available INTEGER DEFAULT 1,
        FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
    )`);

    // 4. Orders
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        driver_id INTEGER,
        restaurant_id INTEGER,
        status TEXT, -- PENDING, ACCEPTED, ON_WAY, DELIVERED, CANCELLED
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
    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        price_at_time REAL,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

    // Indexes for speed
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(driver_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)");
    db.run("CREATE INDEX IF NOT EXISTS idx_products_restaurant ON products(restaurant_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_categories_restaurant ON categories(restaurant_id)");

    console.log("Database Tables Initialized & Indexed");
});

module.exports = db;
