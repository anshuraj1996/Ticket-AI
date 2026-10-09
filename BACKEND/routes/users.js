import express from "express";
import {login, logout, signUp, updateUser, getUsers} from "../controllers/user.js";
import {authenticate} from "../middlewares/auth.js";
import {authRateLimit} from "../middlewares/rateLimit.js";

const router = express.Router();

router.post("/update-user", authenticate, updateUser);
router.get("/users", authenticate, getUsers);

router.post("/signup", authRateLimit, signUp);

router.post("/login", authRateLimit, login);

router.post("/logout", logout);

export default router;