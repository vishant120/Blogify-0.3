const { Router } = require("express");
const { randomBytes, createHmac } = require("crypto");
const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const Notification = require("../models/notification");
const { sendEmail } = require("../middlewares/nodemailer");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const { createTokenForUser } = require("../services/authentication");

const router = Router();

// GET /settings
router.get("/", (req, res) => {
  if (!req.user) {
    return res.redirect("/user/signin?error_msg=Please log in to view settings");
  }
  return res.render("settings", {
    user: req.user,
    success_msg: req.query.success_msg,
    error_msg: req.query.error_msg,
  });
});

// POST /settings/update-profile
router.post("/update-profile", cloudinaryUpload.single("profileImage"), async (req, res) => {
  // ... (code remains the same)
});

// POST /settings/update-privacy (FIXED & IMPROVED)
router.post("/update-privacy", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to update privacy");
    }

    // A checkbox sends 'on' when checked and is undefined when not.
    // This logic correctly converts that to true/false.
    const isPrivate = req.body.isPrivate === 'on';

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { isPrivate: isPrivate },
      { new: true }
    );
    if (!updatedUser) {
      return res.redirect("/settings?error_msg=User not found");
    }

    // Re-issue the token with updated user data
    const token = createTokenForUser(updatedUser);
    res.cookie("token", token, { httpOnly: true });
    return res.redirect("/settings?success_msg=Privacy updated successfully");
  } catch (err) {
    console.error("Error updating privacy:", err);
    return res.redirect("/settings?error_msg=Failed to update privacy");
  }
});

// ... (All other routes like password reset and delete account remain the same)

module.exports = router;
