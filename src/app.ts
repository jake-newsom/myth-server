import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";

// These modules will be created later, so we'll need to handle imports properly
// For now, we're using require with type assertions
const apiRoutes = require("./api/routes") as express.Router;
const { centralErrorHandler } =
  require("./api/middlewares/error.middleware") as {
    centralErrorHandler: (
      err: any,
      req: Request,
      res: Response,
      next: NextFunction
    ) => void;
  };

// Setup Swagger
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Viking Vengeance API",
      version: "1.0.0",
      description: "API for the Viking Vengeance card game",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
    ],
  },
  // Path to API docs
  apis: ["./src/openapi/*.yaml"],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

const app = express();

// Middleware
app.use(cors()); // Configure specific origins in production
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Swagger documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Routes
app.use("/api", apiRoutes);

// Health check route
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

// Centralized Error Handling
app.use(centralErrorHandler);

// 404 Handler for undefined routes
app.use((req: Request, res: Response, next: NextFunction) => {
  res
    .status(404)
    .json({ error: { message: "Resource not found on this server." } });
});

module.exports = app;
