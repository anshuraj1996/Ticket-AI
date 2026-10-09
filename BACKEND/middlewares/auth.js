import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { cacheGetJSON, cacheSetJSON, userCacheKey } from "../utils/cache.js";

// Short TTL: role changes also clear the entry (see updateUser)
const USER_CACHE_TTL_SECONDS = Number(process.env.USER_CACHE_TTL_SECONDS || 60);

export const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.error("Token verification error:", error.message);
    return res.status(403).json({ message: "Invalid token" });
  }

  try {
    const cacheKey = userCacheKey(decoded.id);

    // req.user is always a plain object (cache hit or MongoDB), controllers only read it
    let user = await cacheGetJSON(cacheKey);
    if (!user) {
      user = await User.findById(decoded.id).select("-password").lean();
      if (user) await cacheSetJSON(cacheKey, user, USER_CACHE_TTL_SECONDS);
    }

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};
