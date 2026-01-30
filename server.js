const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const compression = require('compression');
const db = require('./database');
const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const analyticsRoutes = require('./routes/analytics');

const { Expo } = require('expo-server-sdk');

let expo = new Expo();

const app = express();

// Standard CORS Configuration
const corsOptions = {
    origin: '*', // Allow ALL origins (easier for tunnels)
    credentials: false, // Disable strict credentials check since fetch doesn't use them
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'bypass-tunnel-reminder', 'pinggy-skip-browser-warning', 'Origin', 'Accept', 'X-Requested-With']
};

app.use(cors(corsOptions));
// Standard preflight for all routes
app.options('*', cors(corsOptions));

app.use(compression());
app.use(express.json());


// ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/analytics', analyticsRoutes);

// Serve uploaded images with cache
app.use('/uploads', express.static('uploads', { maxAge: '1d' }));

// REQUEST LOGGER (exclude static files to reduce log flood)
app.use((req, res, next) => {
    if (!req.url.startsWith('/uploads')) {
        console.log(`[REQUEST] ${req.method} ${req.url}`);
    }
    next();
});

app.get('/', (req, res) => {
    res.send('<h1>🛵 DELIVERY BACKEND ONLINE</h1><p>Status: 200 OK</p>');
});

// TEST DB ENDPOINT
app.get('/api/test-db', (req, res) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: "Database Connected", tables: rows });
        }
    });
});

// ===== ORDER API ROUTES =====
app.get('/api/orders/:restaurantId', async (req, res) => {
    try {
        const orders = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC", [req.params.restaurantId], (err, rows) => {
                if (err) reject(err); else resolve(rows);
            });
        });

        for (const order of orders) {
            // Fix Timezone: SQLite returns UTC sting without 'Z'. We append it so JS treats it as UTC.
            if (order.created_at && !order.created_at.includes('Z')) {
                order.created_at += 'Z';
            }

            // Fetch Items
            const items = await new Promise((resolve, reject) => {
                db.all(`
                    SELECT p.name, oi.quantity, oi.price_at_time as price 
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = ?
                 `, [order.id], (err, rows) => {
                    if (err) resolve([]); else resolve(rows);
                });
            });
            order.items = JSON.stringify(items);
        }

        res.json(orders);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/orders/:orderId/status', (req, res) => {
    const { status, estimated_time } = req.body;
    const stmt = db.prepare("UPDATE orders SET status = ?, estimated_time = ? WHERE id = ?");
    stmt.run(status, estimated_time || null, req.params.orderId, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Order updated" });
    });
    stmt.finalize();
});

// GET active order for client
app.get('/api/orders/active/client/:clientId', (req, res) => {
    db.get("SELECT * FROM orders WHERE client_id = ? AND status NOT IN ('DELIVERED', 'CANCELLED') ORDER BY created_at DESC LIMIT 1", [req.params.clientId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || null);
    });
});

// GET active order for driver
app.get('/api/orders/active/driver/:driverId', (req, res) => {
    db.get("SELECT * FROM orders WHERE driver_id = ? AND status NOT IN ('DELIVERED', 'CANCELLED') ORDER BY created_at DESC LIMIT 1", [req.params.driverId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || null);
    });
});

// CANCEL order
app.post('/api/orders/cancel/:orderId', (req, res) => {
    db.run("UPDATE orders SET status = 'CANCELLED' WHERE id = ?", [req.params.orderId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Order cancelled" });
    });
});

// ACCEPT order from notification
app.post('/api/orders/:orderId/accept', (req, res) => {
    const { driverId } = req.body;
    const { orderId } = req.params;

    console.log(`[NOTIFICATION] Driver ${driverId} accepting order ${orderId}`);

    db.run("UPDATE orders SET driver_id = ?, status = 'ACCEPTED' WHERE id = ? AND status = 'READY'",
        [driverId, orderId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            if (this.changes === 0) {
                return res.status(400).json({ error: "Order already taken or not available" });
            }

            console.log(`✅ Order ${orderId} accepted by driver ${driverId}`);
            res.json({ success: true, message: "Order accepted" });

            // Notify via socket - find the socket for this driverId
            Object.keys(drivers).forEach(sid => {
                if (drivers[sid].driverId == driverId) {
                    io.to(sid).emit('order_assigned', {
                        orderId,
                        status: 'DRIVER_ASSIGNED'
                    });
                }
            });
        }
    );
});

// REJECT order from notification
app.post('/api/orders/:orderId/reject', (req, res) => {
    const { driverId } = req.body;
    const { orderId } = req.params;

    console.log(`[NOTIFICATION] Driver ${driverId} rejected order ${orderId}`);
    res.json({ success: true, message: "Order rejected" });
});

// ===== PUSH NOTIFICATION HELPER =====
const sendPushNotification = async (userId, title, body, data = {}, category = null) => {
    db.get("SELECT push_token FROM users WHERE id = ?", [userId], async (err, user) => {
        if (err || !user || !user.push_token) {
            console.log(`⚠️ Cannot send notification to user ${userId}: ${err ? err.message : 'No token found'}`);
            return;
        }

        if (!Expo.isExpoPushToken(user.push_token)) {
            console.log(`❌ Invalid Expo token for user ${userId}: ${user.push_token}`);
            return;
        }

        // Convert all data values to strings
        const stringData = {};
        for (const key in data) {
            stringData[key] = String(data[key]);
        }

        let message = {
            to: user.push_token,
            sound: 'default',
            title: title,
            body: body,
            data: stringData,
            priority: 'high',
            channelId: 'orders', // Matches Driver App channel
            android: {
                channelId: 'orders',
                priority: 'max', // Max priority for heads-up
                vibrate: [0, 250, 250, 250]
            }
        };
        if (category) {
            message.categoryIdentifier = category;
            stringData._category = category; // For Android button matching
        }

        message.data = stringData; // Update with _category if added

        try {
            console.log(`🚀 Sending push notification to user ${userId}: "${title}"`);
            const result = await expo.sendPushNotificationsAsync([message]);
            console.log(`✅ Notification sent:`, result);
        } catch (error) {
            console.error(`❌ Error sending push notification to user ${userId}:`, error);
        }
    });
};

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        credentials: true,
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization", "bypass-tunnel-reminder", "pinggy-skip-browser-warning", "Origin", "Accept", "X-Requested-With"]
    },

    // Optimize for tunnel performance
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    transports: ['websocket', 'polling'], // Prefer WebSocket
    allowUpgrades: true
});

// ===== SOCKET.IO REALTIME SYSTEM =====
let drivers = {}; // { socketId: { name, status, location } }
let admins = {}; // { socketId: { restaurantId } }
let clients = {}; // { socketId: { userId } }

io.on('connection', (socket) => {
    console.log(`[SOCKET] Cliente conectado: ${socket.id}`);

    // ===== DRIVER REGISTRATION =====
    socket.on('register_driver', ({ driverName, driverId }) => {
        console.log(`[DRIVER] Registrado: ${driverName} (${socket.id})`);
        drivers[socket.id] = {
            driverId,
            name: driverName,
            status: 'AVAILABLE',
            location: null,
            currentOrder: null
        };

        // Check for active order to resume with Restaurant Data
        db.get(`
            SELECT o.*, r.lat as rest_lat, r.lng as rest_lng, r.name as rest_name
            FROM orders o
            JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.driver_id = ? AND o.status NOT IN ('DELIVERED', 'CANCELLED')
            LIMIT 1
        `, [driverId], async (err, order) => {
            if (order) {
                drivers[socket.id].status = 'BUSY';
                drivers[socket.id].currentOrder = order.id;

                // Fetch Items
                const items = await new Promise((resolve) => {
                    db.all(`
                       SELECT p.name, oi.quantity 
                       FROM order_items oi
                       JOIN products p ON oi.product_id = p.id
                       WHERE oi.order_id = ?
                    `, [order.id], (err, rows) => {
                        if (err) resolve([]); else resolve(rows);
                    });
                });

                // Construct full order object
                const fullOrder = {
                    ...order,
                    items: JSON.stringify(items),
                    restaurantLocation: {
                        latitude: order.rest_lat,
                        longitude: order.rest_lng
                    },
                    restaurantName: order.rest_name
                };
                console.log("🔄 Resuming order for driver with items:", items.length);
                socket.emit('resume_driver_order', fullOrder);
            }
        });
    });

    socket.on('driver_location', (coords) => {
        if (drivers[socket.id]) {
            drivers[socket.id].location = coords;

            // If driver has active order, send location to client
            if (drivers[socket.id].currentOrder) {
                const orderId = drivers[socket.id].currentOrder;
                db.get("SELECT client_id FROM orders WHERE id = ?", [orderId], (err, order) => {
                    if (order && clients[order.client_id]) {
                        io.to(clients[order.client_id]).emit('driver_location_update', coords);
                    }
                });
            }
        }
    });

    // ===== ADMIN REGISTRATION =====
    socket.on('register_admin', ({ restaurantId }) => {
        console.log(`[ADMIN] Registrado: Restaurante ${restaurantId} (${socket.id})`);
        admins[socket.id] = { restaurantId };
    });

    // ===== CLIENT REGISTRATION =====
    socket.on('register_client', ({ userId }) => {
        console.log(`[CLIENT] Registrado: Usuario ${userId} (${socket.id})`);
        clients[userId] = socket.id;

        // Check for active order to resume
        db.get("SELECT * FROM orders WHERE client_id = ? AND status NOT IN ('DELIVERED', 'CANCELLED') LIMIT 1", [userId], (err, order) => {
            if (order) {
                socket.emit('resume_order', {
                    orderId: order.id,
                    status: order.status,
                    estimatedTime: order.estimated_time,
                    driverName: order.driver_name
                });
            }
        });
    });

    // ===== ORDER PLACEMENT (CLIENT) =====
    socket.on('place_order', ({ restaurantId, items, totalPrice, deliveryAddress, deliveryLat, deliveryLng, clientId }) => {
        console.log(`[ORDER] Nuevo pedido para restaurante ${restaurantId}`);

        const stmt = db.prepare(`
            INSERT INTO orders (restaurant_id, client_id, status, total_price, delivery_address, delivery_lat, delivery_lng)
            VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
        `);

        stmt.run(restaurantId, clientId, totalPrice, deliveryAddress, deliveryLat, deliveryLng, function (err) {
            if (err) {
                console.error(err);
                socket.emit('order_error', { message: err.message });
                return;
            }

            const orderId = this.lastID;

            // Save order items
            const itemStmt = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES (?, ?, ?, ?)");

            let itemsToProcess = items;
            if (typeof items === 'string') {
                try {
                    itemsToProcess = JSON.parse(items);
                } catch (e) {
                    console.error("[ORDER] Error al parsear items:", e);
                    itemsToProcess = [];
                }
            }

            if (Array.isArray(itemsToProcess)) {
                itemsToProcess.forEach(item => {
                    const productId = item.productId || item.id;
                    itemStmt.run(orderId, productId, item.quantity, item.price);
                });
            } else {
                console.warn("[ORDER] Los items recibidos no son un array válido");
            }
            itemStmt.finalize();

            // Notify client
            socket.emit('order_placed', { orderId, status: 'PENDING' });

            // Notify restaurant admin
            let foundAdmin = false;
            Object.keys(admins).forEach(adminSocket => {
                // Use loose equality to be safe with string/number IDs from client
                if (admins[adminSocket].restaurantId == restaurantId) {
                    io.to(adminSocket).emit('new_order', {
                        orderId,
                        items,
                        totalPrice,
                        deliveryAddress,
                        status: 'PENDING'
                    });
                    foundAdmin = true;
                }
            });

            if (foundAdmin) {
                console.log(`🔔 Notificación de pedido enviada a Admin de restaurante ${restaurantId}`);
            } else {
                console.warn(`⚠️ No hay Admin conectado vía Socket para el restaurante ${restaurantId}`);
            }
        });
        stmt.finalize();
    });

    // ===== ADMIN CONFIRMS ORDER =====
    socket.on('confirm_order', ({ orderId, estimatedTime }) => {
        console.log(`[ADMIN] Confirmó pedido ${orderId}, tiempo: ${estimatedTime}min`);

        const stmt = db.prepare("UPDATE orders SET status = 'CONFIRMED', estimated_time = ? WHERE id = ?");
        stmt.run(estimatedTime, orderId, function (err) {
            if (err) {
                console.error(err);
                return;
            }

            // Notify client
            db.get("SELECT client_id FROM orders WHERE id = ?", [orderId], (err, order) => {
                if (order && clients[order.client_id]) {
                    io.to(clients[order.client_id]).emit('order_confirmed', {
                        orderId,
                        estimatedTime,
                        status: 'CONFIRMED'
                    });
                }
            });
        });
        stmt.finalize();
    });

    // ===== ADMIN MARKS ORDER READY =====
    socket.on('mark_ready', ({ orderId }) => {
        console.log(`[ADMIN] Pedido ${orderId} listo para pickup`);

        const stmt = db.prepare("UPDATE orders SET status = 'READY' WHERE id = ?");
        stmt.run(orderId, function (err) {
            if (err) {
                console.error(err);
                return;
            }

            db.get(`
                SELECT o.*, r.lat as rest_lat, r.lng as rest_lng, r.name as rest_name 
                FROM orders o 
                JOIN restaurants r ON o.restaurant_id = r.id 
                WHERE o.id = ?
            `, [orderId], async (err, order) => {
                if (err || !order) {
                    console.log("❌ Error fetching order for drivers:", err);
                    return;
                }

                // Fetch Items
                const items = await new Promise((resolve) => {
                    db.all(`
                       SELECT p.name, oi.quantity 
                       FROM order_items oi
                       JOIN products p ON oi.product_id = p.id
                       WHERE oi.order_id = ?
                    `, [order.id], (err, rows) => {
                        if (err) resolve([]); else resolve(rows);
                    });
                });
                const itemsStr = items.map(i => `${i.quantity}x ${i.name}`).join(', ');

                console.log("📦 Order data for drivers:", { id: order.id, items: itemsStr });

                // Notify client
                if (clients[order.client_id]) {
                    io.to(clients[order.client_id]).emit('order_ready', { orderId, status: 'READY' });
                }

                // Push notifications
                db.all("SELECT id, name, push_token FROM users WHERE role = 'driver' AND push_token IS NOT NULL", [], (err, allDrivers) => {
                    if (err) {
                        console.error("❌ Error querying drivers for push notifications:", err);
                        return;
                    }

                    allDrivers.forEach(driver => {
                        sendPushNotification(driver.id, "¡Nuevo Pedido Disponible!", `${itemsStr} - $${order.total_price}`, {
                            orderId: order.id,
                            deliveryAddress: order.delivery_address,
                            totalPrice: order.total_price,
                            items: JSON.stringify(items),
                            deliveryLat: order.delivery_lat,
                            deliveryLng: order.delivery_lng,
                            restaurantName: order.rest_name,
                            restaurantLocation: JSON.stringify({
                                latitude: order.rest_lat,
                                longitude: order.rest_lng
                            })
                        }, 'ORDER_OFFER');
                    });
                });

                Object.keys(drivers).forEach(driverSocket => {
                    if (drivers[driverSocket].status === 'AVAILABLE') {
                        io.to(driverSocket).emit('order_available', {
                            orderId,
                            restaurantId: order.restaurant_id,
                            restaurantName: order.rest_name,
                            items: JSON.stringify(items),
                            restaurantLocation: {
                                latitude: order.rest_lat,
                                longitude: order.rest_lng
                            },
                            deliveryAddress: order.delivery_address,
                            totalPrice: order.total_price,
                            deliveryLat: order.delivery_lat,
                            deliveryLng: order.delivery_lng
                        });
                    }
                });
            });
        });
        stmt.finalize();
    });

    // ===== DRIVER ACCEPTS ORDER =====
    socket.on('accept_order', ({ orderId, driverName }) => {
        console.log(`[DRIVER] ${driverName} aceptó pedido ${orderId}`);

        const stmt = db.prepare("UPDATE orders SET status = 'DRIVER_ASSIGNED', driver_id = ?, driver_name = ? WHERE id = ?");
        db.get("SELECT id FROM users WHERE name = ? AND role = 'driver' LIMIT 1", [driverName], (err, driver) => {
            const driverId = driver ? driver.id : null;

            stmt.run(driverId, driverName, orderId, function (err) {
                if (err) {
                    console.error(err);
                    return;
                }

                // Update driver status
                if (drivers[socket.id]) {
                    drivers[socket.id].status = 'BUSY';
                    drivers[socket.id].currentOrder = orderId;
                }

                // Notify client
                db.get("SELECT client_id, restaurant_id FROM orders WHERE id = ?", [orderId], (err, order) => {
                    if (order) {
                        if (clients[order.client_id]) {
                            io.to(clients[order.client_id]).emit('driver_assigned', {
                                orderId,
                                driverName,
                                status: 'DRIVER_ASSIGNED'
                            });
                        }

                        // Notify admin
                        Object.keys(admins).forEach(adminSocket => {
                            if (admins[adminSocket].restaurantId === order.restaurant_id) {
                                io.to(adminSocket).emit('driver_assigned_admin', { orderId, driverName });
                            }
                        });
                    }
                });
            });
            stmt.finalize();
        });
    });

    // ===== DRIVER MARKS PICKED UP =====
    socket.on('mark_picked_up', ({ orderId }) => {
        console.log(`[DRIVER] Pedido ${orderId} recogido, en camino`);

        const stmt = db.prepare("UPDATE orders SET status = 'PICKED_UP' WHERE id = ?");
        stmt.run(orderId, function (err) {
            if (err) {
                console.error(err);
                return;
            }

            // Notify client & admin
            db.get("SELECT client_id, restaurant_id FROM orders WHERE id = ?", [orderId], (err, order) => {
                if (order) {
                    if (clients[order.client_id]) {
                        io.to(clients[order.client_id]).emit('order_picked_up', {
                            orderId,
                            status: 'PICKED_UP'
                        });
                    }

                    // Notify Admin
                    Object.keys(admins).forEach(adminSocket => {
                        if (admins[adminSocket].restaurantId === order.restaurant_id) {
                            io.to(adminSocket).emit('order_picked_up_admin', { orderId });
                        }
                    });
                }
            });
        });
        stmt.finalize();
    });

    // ===== DRIVER MARKS DELIVERED =====
    socket.on('mark_delivered', ({ orderId }) => {
        console.log(`[DRIVER] Pedido ${orderId} entregado`);

        const stmt = db.prepare("UPDATE orders SET status = 'DELIVERED' WHERE id = ?");
        stmt.run(orderId, function (err) {
            if (err) {
                console.error(err);
                return;
            }

            // Update driver status
            if (drivers[socket.id]) {
                drivers[socket.id].status = 'AVAILABLE';
                drivers[socket.id].currentOrder = null;
            }

            // Notify all parties
            db.get("SELECT client_id, restaurant_id FROM orders WHERE id = ?", [orderId], (err, order) => {
                if (order) {
                    // Client
                    if (clients[order.client_id]) {
                        io.to(clients[order.client_id]).emit('order_delivered', { orderId, status: 'DELIVERED' });
                    }

                    // Admin
                    Object.keys(admins).forEach(adminSocket => {
                        if (admins[adminSocket].restaurantId === order.restaurant_id) {
                            io.to(adminSocket).emit('order_completed', { orderId });
                        }
                    });
                }
            });
        });
        stmt.finalize();
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', () => {
        console.log(`[SOCKET] Desconectado: ${socket.id}`);
        delete drivers[socket.id];
        delete admins[socket.id];

        // Remove from clients
        Object.keys(clients).forEach(userId => {
            if (clients[userId] === socket.id) {
                delete clients[userId];
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📡 Socket.IO ready for real-time orders`);
});
