# DriveFleet Server

Backend API for the DriveFleet Car Rental Platform.

## Technologies Used

- Node.js
- Express.js
- MongoDB
- JSON Web Token (JWT)
- Cookie Parser
- CORS
- dotenv

## Features

- REST API for managing car listings
- Add, update, and delete cars
- Search cars by name
- Filter cars by vehicle type
- Create and retrieve bookings
- Automatically increase booking count using MongoDB `$inc`
- JWT authentication with HTTPOnly cookies
- Protected private API routes
- Owner-only car update and delete operations

## Environment Variables

Create a `.env` file in the server root and configure:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
ACCESS_TOKEN_SECRET=your_jwt_access_token_secret
CLIENT_URL=http://localhost:5173
NODE_ENV=development