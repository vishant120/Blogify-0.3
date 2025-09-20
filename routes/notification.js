const { Router } = require("express");
const Notification = require("../models/notification");
const User = require("../models/user");

const router = Router();

// Utility to render notifications page
const renderNotifications = (res, user, notifications, messages = {}) => {
  return res.render("notifications", {
    user: user || null,
    notifications,
    success_msg: messages.success_msg || null,
    error_msg: messages.error_msg || null,
  });
};

// GET /notification
router.get("/", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to view notifications");
    }

    const notifications = await Notification.find({ recipient: req.user._id })
      .populate("sender", "fullname profileImageURL")
      .populate("blogId", "title coverImage")
      .sort({ createdAt: -1 });

    renderNotifications(res, req.user, notifications, {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg,
    });
  } catch (err) {
    console.error("Error loading notifications:", err);
    renderNotifications(res, req.user, [], { error_msg: "Failed to load notifications" });
  }
});

// POST /notification/accept/:id
router.post("/accept/:id", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to accept follow requests");
    }

    const notification = await Notification.findById(req.params.id);
    if (!notification || notification.recipient.toString() !== req.user._id.toString()) {
      return res.redirect("/notification?error_msg=Notification not found or unauthorized");
    }

    if (notification.type !== "FOLLOW_REQUEST" || notification.status !== "PENDING") {
      return res.redirect("/notification?error_msg=Invalid or already processed notification");
    }

    await Promise.all([
      User.findByIdAndUpdate(req.user._id, { $addToSet: { followers: notification.sender } }, { new: true }),
      User.findByIdAndUpdate(notification.sender, { $addToSet: { following: req.user._id } }, { new: true }),
      Notification.findByIdAndUpdate(req.params.id, { status: "ACCEPTED" }, { new: true }),
    ]);

    return res.redirect("/notification?success_msg=Follow request accepted");
  } catch (err) {
    console.error("Error accepting follow request:", err);
    return res.redirect("/notification?error_msg=Failed to accept follow request");
  }
});

// POST /notification/reject/:id
router.post("/reject/:id", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to reject follow requests");
    }

    const notification = await Notification.findById(req.params.id);
    if (!notification || notification.recipient.toString() !== req.user._id.toString()) {
      return res.redirect("/notification?error_msg=Notification not found or unauthorized");
    }

    if (notification.type !== "FOLLOW_REQUEST" || notification.status !== "PENDING") {
      return res.redirect("/notification?error_msg=Invalid or already processed notification");
    }

    await Notification.findByIdAndUpdate(req.params.id, { status: "REJECTED" }, { new: true });
    return res.redirect("/notification?success_msg=Follow request rejected");
  } catch (err) {
    console.error("Error rejecting follow request:", err);
    return res.redirect("/notification?error_msg=Failed to reject follow request");
  }
});

// POST /notification/read/:id
router.post("/read/:id", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to mark notifications as read");
    }

    const notification = await Notification.findById(req.params.id);
    if (!notification || notification.recipient.toString() !== req.user._id.toString()) {
      return res.redirect("/notification?error_msg=Notification not found or unauthorized");
    }

    if (notification.type === "FOLLOW_REQUEST") {
      return res.redirect("/notification?error_msg=Cannot mark follow request as read");
    }

    await Notification.findByIdAndUpdate(req.params.id, { status: "READ" }, { new: true });
    return res.redirect("/notification?success_msg=Notification marked as read");
  } catch (err) {
    console.error("Error marking notification as read:", err);
    return res.redirect("/notification?error_msg=Failed to mark notification as read");
  }
});

module.exports = router;
