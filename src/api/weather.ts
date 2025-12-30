import express from "express";
import { getWeatherData } from "../application/weather";
import { authenticationMiddleware } from "./middlewares/authentication-middleware";

const weatherRouter = express.Router();

// GET /api/weather - Get current weather data with solar impact analysis
weatherRouter.route("/").get(authenticationMiddleware, getWeatherData);

export default weatherRouter;
