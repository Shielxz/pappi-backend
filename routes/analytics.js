const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/analytics/summary
// Returns: total_sales, total_orders, avg_ticket, pending_orders
// Helper to get range condition
const getRangeCondition = (range, start, end) => {
    switch (range) {
        case 'today':
            return " AND created_at >= date('now', 'start of day')";
        case 'week':
            return " AND created_at >= date('now', '-7 days')";
        case 'month':
            return " AND created_at >= date('now', 'start of month')";
        case 'year':
            return " AND created_at >= date('now', 'start of year')";
        case 'range':
            if (start && end) {
                return ` AND date(created_at) BETWEEN '${start}' AND '${end}'`;
            }
            return "";
        default:
            return ""; // All time
    }
};

// GET /api/analytics/summary
// Returns: total_sales, total_orders, avg_ticket, pending_orders
router.get('/summary/:restaurantId', (req, res) => {
    const { restaurantId } = req.params;
    const { range, start, end } = req.query;

    const dateFilter = getRangeCondition(range, start, end);

    const query = `
        SELECT 
            COUNT(*) as total_orders,
            SUM(CASE WHEN status != 'CANCELLED' THEN total_price ELSE 0 END) as total_sales,
            AVG(CASE WHEN status != 'CANCELLED' THEN total_price ELSE NULL END) as avg_ticket,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_count
        FROM orders 
        WHERE restaurant_id = ? ${dateFilter}
    `;

    db.get(query, [restaurantId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            totalOrders: row.total_orders || 0,
            totalSales: row.total_sales || 0,
            avgTicket: row.avg_ticket || 0,
            pendingOrders: row.pending_count || 0
        });
    });
});

// GET /api/analytics/sales-chart
// Returns sales grouped by day
router.get('/sales-chart/:restaurantId', (req, res) => {
    const { restaurantId } = req.params;
    const { range, start, end } = req.query;

    const dateFilter = getRangeCondition(range, start, end);
    const defaultLimit = range ? "" : "AND created_at >= date('now', '-30 days')"; // Default to 30 days if no range

    const query = `
        SELECT 
            DATE(created_at) as date, 
            SUM(total_price) as sales,
            COUNT(*) as orders
        FROM orders 
        WHERE restaurant_id = ? 
          AND status != 'CANCELLED'
          ${dateFilter || defaultLimit}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
    `;

    db.all(query, [restaurantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET /api/analytics/status-distribution
router.get('/status-distribution/:restaurantId', (req, res) => {
    const { restaurantId } = req.params;
    const { range, start, end } = req.query;
    const dateFilter = getRangeCondition(range, start, end);

    const query = `SELECT status, COUNT(*) as count FROM orders WHERE restaurant_id = ? ${dateFilter} GROUP BY status`;

    db.all(query, [restaurantId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Normalize for frontend
        const map = {
            'PENDING': 'Pendientes',
            'CONFIRMED': 'Confirmados',
            'READY': 'Listos',
            'DRIVER_ASSIGNED': 'Asignados',
            'PICKED_UP': 'En Camino',
            'DELIVERED': 'Entregados',
            'CANCELLED': 'Cancelados'
        };

        const data = rows.map(r => ({
            name: map[r.status] || r.status,
            value: r.count,
            rawStatus: r.status
        }));
        res.json(data);
    });
});

module.exports = router;
