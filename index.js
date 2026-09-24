
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
].filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let cars, bookings;

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized access" });
    }

    req.user = decoded;
    next();
  });
};

const validId = (id) => ObjectId.isValid(id);

async function run() {
  await client.connect();

  const db = client.db("driveFleetDB");

  cars = db.collection("cars");
  bookings = db.collection("bookings");

  await cars.createIndex({ ownerEmail: 1 });
  await bookings.createIndex({ userEmail: 1 });

  await client.db("admin").command({ ping: 1 });

  console.log("MongoDB connected");
}

run().catch(console.error);

// Root route
app.get("/", (req, res) => {
  res.send({ message: "DriveFleet API is running" });
});

// Database health-check route
app.get("/health", async (req, res) => {
  try {
    await client.db("admin").command({ ping: 1 });

    res.status(200).send({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).send({
      status: "unavailable",
      database: "disconnected",
    });
  }
});

// Create JWT cookie
app.post("/jwt", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send({ message: "Email is required" });
  }

  const token = jwt.sign(
    { email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("token", token, cookieOptions()).send({ success: true });
});

// Logout
app.post("/logout", (req, res) => {
  res
    .clearCookie("token", {
      ...cookieOptions(),
      maxAge: undefined,
    })
    .send({ success: true });
});

// Get all cars with optional search and filters
app.get("/cars", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const type = String(req.query.type || "").trim();
  const available = req.query.available;
  const limit = Math.min(Number(req.query.limit) || 0, 50);

  const query = {};

  if (search) {
    query.carName = {
      $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }

  if (type && type !== "All") {
    query.carType = type;
  }

  if (available === "true") {
    query.availability = true;
  }

  let cursor = cars.find(query).sort({ createdAt: -1 });

  if (limit) {
    cursor = cursor.limit(limit);
  }

  res.send(await cursor.toArray());
});

// Get single car
app.get("/cars/:id", async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).send({ message: "Invalid car id" });
  }

  const car = await cars.findOne({
    _id: new ObjectId(req.params.id),
  });

  if (!car) {
    return res.status(404).send({ message: "Car not found" });
  }

  res.send(car);
});

// Add a car
app.post("/cars", verifyToken, async (req, res) => {
  const body = req.body;

  if (req.user.email !== body.ownerEmail) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  const required = [
    "carName",
    "dailyRentPrice",
    "carType",
    "image",
    "seatCapacity",
    "pickupLocation",
    "description",
  ];

  if (
    required.some(
      (key) => body[key] === undefined || body[key] === ""
    )
  ) {
    return res.status(400).send({
      message: "Please provide all required fields",
    });
  }

  const car = {
    carName: String(body.carName).trim(),
    dailyRentPrice: Number(body.dailyRentPrice),
    carType: String(body.carType),
    image: String(body.image),
    seatCapacity: Number(body.seatCapacity),
    pickupLocation: String(body.pickupLocation).trim(),
    description: String(body.description).trim(),
    availability:
      body.availability === true || body.availability === "true",
    ownerEmail: req.user.email,
    ownerName: String(body.ownerName || ""),
    booking_count: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Validate required text fields
  if (
    !car.carName ||
    !car.pickupLocation ||
    !car.description ||
    !car.image.trim() ||
    !car.carType.trim()
  ) {
    return res.status(400).send({
      message: "Please provide valid car details",
    });
  }

  // Validate price and seat capacity
  if (
    !Number.isFinite(car.dailyRentPrice) ||
    car.dailyRentPrice <= 0 ||
    !Number.isInteger(car.seatCapacity) ||
    car.seatCapacity < 1
  ) {
    return res.status(400).send({
      message: "Please provide a valid price and seat capacity",
    });
  }

  const result = await cars.insertOne(car);

  res.status(201).send({
    ...result,
    car: { ...car, _id: result.insertedId },
  });
});

// Get current user's cars
app.get("/my-cars", verifyToken, async (req, res) => {
  res.send(
    await cars
      .find({ ownerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray()
  );
});

// Update a car (owner only)
app.patch("/cars/:id", verifyToken, async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).send({ message: "Invalid car id" });
  }

  const filter = {
    _id: new ObjectId(req.params.id),
    ownerEmail: req.user.email,
  };

  const existing = await cars.findOne(filter);

  if (!existing) {
    return res.status(404).send({
      message: "Car not found or you are not the owner",
    });
  }

  const allowed = [
    "dailyRentPrice",
    "description",
    "availability",
    "image",
    "carType",
    "pickupLocation",
  ];

  const update = {};

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      update[key] = req.body[key];
    }
  }

  // Validate rental price
  if (update.dailyRentPrice !== undefined) {
    update.dailyRentPrice = Number(update.dailyRentPrice);

    if (
      !Number.isFinite(update.dailyRentPrice) ||
      update.dailyRentPrice <= 0
    ) {
      return res.status(400).send({
        message: "Please provide a valid daily rental price",
      });
    }
  }

  // Validate and trim editable text fields
  const textFields = [
    "description",
    "image",
    "carType",
    "pickupLocation",
  ];

  for (const field of textFields) {
    if (update[field] !== undefined) {
      if (
        typeof update[field] !== "string" ||
        !update[field].trim()
      ) {
        return res.status(400).send({
          message: `Please provide a valid ${field}`,
        });
      }

      update[field] = update[field].trim();
    }
  }

  // Validate availability
  if (update.availability !== undefined) {
    if (
      update.availability !== true &&
      update.availability !== false &&
      update.availability !== "true" &&
      update.availability !== "false"
    ) {
      return res.status(400).send({
        message: "Please provide valid availability",
      });
    }

    update.availability =
      update.availability === true ||
      update.availability === "true";
  }

  update.updatedAt = new Date();

  const result = await cars.updateOne(filter, {
    $set: update,
  });

  res.send(result);
});

// Delete a car (owner only)
app.delete("/cars/:id", verifyToken, async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).send({ message: "Invalid car id" });
  }

  const result = await cars.deleteOne({
    _id: new ObjectId(req.params.id),
    ownerEmail: req.user.email,
  });

  if (!result.deletedCount) {
    return res.status(404).send({
      message: "Car not found or you are not the owner",
    });
  }

  res.send(result);
});

// Create booking
app.post("/bookings", verifyToken, async (req, res) => {
  const { carId, driverNeeded, specialNote = "" } = req.body;

  if (!validId(carId)) {
    return res.status(400).send({ message: "Invalid car id" });
  }

  const car = await cars.findOne({
    _id: new ObjectId(carId),
  });

  if (!car) {
    return res.status(404).send({ message: "Car not found" });
  }

  if (!car.availability) {
    return res.status(409).send({
      message: "This car is currently unavailable",
    });
  }

  const duplicate = await bookings.findOne({
    carId,
    userEmail: req.user.email,
    status: "confirmed",
  });

  if (duplicate) {
    return res.status(409).send({
      message: "You already booked this car",
    });
  }

  const booking = {
    carId,
    carName: car.carName,
    carImage: car.image,
    totalPrice: Number(car.dailyRentPrice),
    driverNeeded:
      driverNeeded === true || driverNeeded === "Yes",
    specialNote: String(specialNote).trim(),
    userEmail: req.user.email,
    bookingDate: new Date(),
    status: "confirmed",
  };

  const result = await bookings.insertOne(booking);

  await cars.updateOne(
    { _id: car._id },
    { $inc: { booking_count: 1 } }
  );

  res.status(201).send({
    ...result,
    booking,
  });
});

// Get current user's bookings
app.get("/my-bookings", verifyToken, async (req, res) => {
  res.send(
    await bookings
      .find({ userEmail: req.user.email })
      .sort({ bookingDate: -1 })
      .toArray()
  );
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).send({
    message: "Internal server error",
  });
});

app.listen(port, () => {
  console.log(`DriveFleet server running on ${port}`);
});