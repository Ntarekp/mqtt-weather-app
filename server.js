const mqtt = require("mqtt");
const sqlite3 = require("sqlite3").verbose();
const express = require("express");
const cors = require("cors");

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to SQLite database
const db = new sqlite3.Database("weather_data.db", (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
        process.exit(1);
    }
    console.log("Connected to SQLite database.");
    db.run(
        `CREATE TABLE IF NOT EXISTS sensor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic TEXT NOT NULL,
            value REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("Error creating table:", err.message);
                process.exit(1);
            }
        }
    );
});

// Connect to MQTT broker
const mqttClient = mqtt.connect("ws://157.173.101.159:9001", {
    reconnectPeriod: 1000, // Automatically reconnect every 1 second if disconnected
});

mqttClient.on("connect", () => {
    console.log("Connected to MQTT via WebSockets");
    mqttClient.subscribe("/work_group_01/room_temp/temperature", (err) => {
        if (err) console.error("Error subscribing to temperature topic:", err.message);
        else console.log("Subscribed to /work_group_01/room_temp/temperature");
    });
    mqttClient.subscribe("/work_group_01/room_temp/humidity", (err) => {
        if (err) console.error("Error subscribing to humidity topic:", err.message);
        else console.log("Subscribed to /work_group_01/room_temp/humidity");
    });
});

mqttClient.on("error", (error) => {
    console.error("MQTT Connection Error:", error.message);
});

mqttClient.on("reconnect", () => {
    console.log("Attempting to reconnect to MQTT broker...");
});

mqttClient.on("close", () => {
    console.log("MQTT connection closed.");
});

// Save MQTT messages to database
mqttClient.on("message", (topic, message) => {
    const value = message.toString();
    console.log(`Received: ${topic} → ${value}`);

    // Validate and parse the value as a number
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) {
        console.error(`Invalid numeric value received for ${topic}: ${value}`);
        return;
    }

    // Insert into database
    const stmt = db.prepare("INSERT INTO sensor_data (topic, value) VALUES (?, ?)");
    stmt.run(topic, numericValue, (err) => {
        if (err) console.error("Error inserting data:", err.message);
    });
    stmt.finalize();
});

// API to fetch the last 30 records (matches frontend's 30-point limit)
app.get("/data", (req, res) => {
    db.all(
        `SELECT id, topic, value, timestamp 
         FROM sensor_data 
         ORDER BY timestamp DESC 
         LIMIT 30`,
        [],
        (err, rows) => {
            if (err) {
                console.error("Error fetching data:", err.message);
                res.status(500).json({ error: err.message });
                return;
            }
            // Reverse to show oldest to newest in the chart
            res.json(rows.reverse());
        }
    );
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("Shutting down...");
    mqttClient.end(() => {
        console.log("MQTT connection closed.");
        db.close((err) => {
            if (err) console.error("Error closing database:", err.message);
            else console.log("Database connection closed.");
            process.exit(0);
        });
    });
});