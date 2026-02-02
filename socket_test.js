// Quick Socket.IO diagnostic test
const { io } = require("socket.io-client");

const API_URL = "https://pappi-backend.onrender.com";

console.log("🧪 Testing Socket.IO connection to:", API_URL);
console.log("-------------------------------------------");

// Test 1: Default connection (no options)
console.log("\n📡 Test 1: Default connection...");
const socket1 = io(API_URL);

socket1.on("connect", () => {
    console.log("✅ Test 1 SUCCESS! Connected via:", socket1.io.engine.transport.name);
    socket1.disconnect();
    runTest2();
});

socket1.on("connect_error", (err) => {
    console.log("❌ Test 1 FAILED:", err.message);
    socket1.disconnect();
    runTest2();
});

// Test 2: With explicit root namespace
function runTest2() {
    console.log("\n📡 Test 2: Explicit root namespace '/'...");
    const socket2 = io(API_URL + "/", {
        transports: ["websocket", "polling"]
    });

    socket2.on("connect", () => {
        console.log("✅ Test 2 SUCCESS! Connected via:", socket2.io.engine.transport.name);
        socket2.disconnect();
        runTest3();
    });

    socket2.on("connect_error", (err) => {
        console.log("❌ Test 2 FAILED:", err.message);
        socket2.disconnect();
        runTest3();
    });
}

// Test 3: Polling only
function runTest3() {
    console.log("\n📡 Test 3: Polling only...");
    const socket3 = io(API_URL, {
        transports: ["polling"]
    });

    socket3.on("connect", () => {
        console.log("✅ Test 3 SUCCESS! Connected via:", socket3.io.engine.transport.name);
        socket3.disconnect();
        runTest4();
    });

    socket3.on("connect_error", (err) => {
        console.log("❌ Test 3 FAILED:", err.message);
        socket3.disconnect();
        runTest4();
    });
}

// Test 4: WebSocket only
function runTest4() {
    console.log("\n📡 Test 4: WebSocket only...");
    const socket4 = io(API_URL, {
        transports: ["websocket"]
    });

    socket4.on("connect", () => {
        console.log("✅ Test 4 SUCCESS! Connected via:", socket4.io.engine.transport.name);
        socket4.disconnect();
        console.log("\n-------------------------------------------");
        console.log("🏁 All tests complete!");
        process.exit(0);
    });

    socket4.on("connect_error", (err) => {
        console.log("❌ Test 4 FAILED:", err.message);
        socket4.disconnect();
        console.log("\n-------------------------------------------");
        console.log("🏁 All tests complete!");
        process.exit(0);
    });
}

// Timeout after 30 seconds
setTimeout(() => {
    console.log("\n⏰ Tests timed out after 30 seconds");
    process.exit(1);
}, 30000);
