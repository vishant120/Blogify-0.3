// routes/profile.js
const { Router } = require("express");
const fs = require("fs").promises;
const { randomBytes, createHmac } = require("crypto");
const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const Notification = require("../models/notification");
const { createTokenForUser } = require("../services/authentication");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");
const mongoose = require("mongoose");

const router = Router();

// Utility: Render Profile with Defaults
const renderProfile = (res, user, profileUser, blogs, isFollowing = false, followStatus = "follow", commonFollowers = [], messages = {}) => {
  return res.render("profile", {
    user: user || null,
    profileUser,
    blogs: blogs || [],
    isFollowing,
    followStatus,
    commonFollowers,
    success_msg: messages.success_msg || null,
    error_msg: messages.error_msg || null,
  });
};

// GET /profile (logged-in user's profile)
router.get("/", async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to view your profile");
    }

    const profileUser = await User.findById(req.user._id)
      .populate("following", "fullname profileImageURL")
      .populate("followers", "fullname profileImageURL")
      .populate({
        path: "likedBlogs",
        populate: { path: "createdBy", select: "fullname profileImageURL" },
      });

    const currentUser = req.user ? await User.findById(req.user._id)
      .populate("followers", "fullname profileImageURL _id")
      .populate("following", "fullname profileImageURL _id")
    : null;

    const allBlogs = await Blog.find({ createdBy: req.user._id })
      .populate("createdBy", "fullname profileImageURL")
      .populate("likes", "fullname profileImageURL")
      .sort({ createdAt: -1 });

    const blogsWithComments = await Promise.all(
      allBlogs.map(async (blog) => {
        const comments = await Comment.find({ blogId: blog._id, parent: null })
          .populate("createdBy", "fullname profileImageURL")
          .populate("likes", "fullname profileImageURL")
          .sort({ createdAt: -1 });

        const replyIds = comments.map(c => c._id);
        const replies = await Comment.find({ parent: { $in: replyIds } })
          .populate("createdBy", "fullname profileImageURL")
          .populate("likes", "fullname profileImageURL")
          .sort({ createdAt: -1 });

        comments.forEach(comment => {
          comment.replies = replies.filter(r => r.parent.toString() === comment._id.toString());
        });

        const totalComments = comments.length + replies.length;

        let likesWithStatus = blog.likes.map(liker => ({
          ...liker._doc,
          followStatus: "follow" // Default
        }));
        if (currentUser) {
          likesWithStatus = await Promise.all(blog.likes.map(async (liker) => {
            if (liker._id.equals(currentUser._id)) {
              return { ...liker._doc, followStatus: "own" };
            }
            const isFollowingLiker = currentUser.following?.some(f => f._id.equals(liker._id)) || false;
            const pendingRequestLiker = await Notification.findOne({
              sender: currentUser._id,
              recipient: liker._id,
              type: "FOLLOW_REQUEST",
              status: "PENDING",
            });
            const followStatusLiker = isFollowingLiker ? "following" : pendingRequestLiker ? "requested" : "follow";
            return { ...liker._doc, followStatus: followStatusLiker };
          }));
        }

        return { ...blog._doc, comments, totalComments, likes: likesWithStatus };
      })
    );

    renderProfile(res, req.user, profileUser, blogsWithComments, false, "own", [], {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg,
    });
  } catch (err) {
    console.error("Error loading profile:", err);
    renderProfile(res, req.user, null, [], false, "follow", [], { error_msg: "Failed to load profile" });
  }
});

// GET /profile/:id (other user's profile)
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return renderProfile(res, req.user, null, [], false, "follow", [], { error_msg: "Invalid user ID" });
    }

    const profileUser = await User.findById(req.params.id)
      .populate("following", "fullname profileImageURL")
      .populate("followers", "fullname profileImageURL")
      .populate({
        path: "likedBlogs",
        populate: { path: "createdBy", select: "fullname profileImageURL" },
      });

    if (!profileUser) {
      return renderProfile(res, req.user, null, [], false, "follow", [], { error_msg: "User not found" });
    }

    const isOwn = req.user ? profileUser._id.equals(req.user._id) : false;
    const isFollowing = req.user 
      ? profileUser.followers?.some((follower) => follower._id.equals(req.user._id)) || false 
      : false;

    let allBlogs = [];
    if (!profileUser.isPrivate || isOwn || isFollowing) {
      allBlogs = await Blog.find({ createdBy: req.params.id })
        .populate("createdBy", "fullname profileImageURL")
        .populate("likes", "fullname profileImageURL")
        .sort({ createdAt: -1 });
    }

    const currentUser = req.user ? await User.findById(req.user._id)
      .populate("followers", "fullname profileImageURL _id")
      .populate("following", "fullname profileImageURL _id")
    : null;

    const blogsWithComments = await Promise.all(
      allBlogs.map(async (blog) => {
        const comments = await Comment.find({ blogId: blog._id, parent: null })
          .populate("createdBy", "fullname profileImageURL")
          .populate("likes", "fullname profileImageURL")
          .sort({ createdAt: -1 });

        const replyIds = comments.map(c => c._id);
        const replies = await Comment.find({ parent: { $in: replyIds } })
          .populate("createdBy", "fullname profileImageURL")
          .populate("likes", "fullname profileImageURL")
          .sort({ createdAt: -1 });

        comments.forEach(comment => {
          comment.replies = replies.filter(r => r.parent.toString() === comment._id.toString());
        });

        const totalComments = comments.length + replies.length;

        let likesWithStatus = blog.likes.map(liker => ({
          ...liker._doc,
          followStatus: "follow" // Default
        }));
        if (currentUser) {
          likesWithStatus = await Promise.all(blog.likes.map(async (liker) => {
            if (liker._id.equals(currentUser._id)) {
              return { ...liker._doc, followStatus: "own" };
            }
            const isFollowingLiker = currentUser.following?.some(f => f._id.equals(liker._id)) || false;
            const pendingRequestLiker = await Notification.findOne({
              sender: currentUser._id,
              recipient: liker._id,
              type: "FOLLOW_REQUEST",
              status: "PENDING",
            });
            const followStatusLiker = isFollowingLiker ? "following" : pendingRequestLiker ? "requested" : "follow";
            return { ...liker._doc, followStatus: followStatusLiker };
          }));
        }

        return { ...blog._doc, comments, totalComments, likes: likesWithStatus };
      })
    );

    let followStatus = "follow";
    let commonFollowers = [];
    if (req.user) {
      const pending = await Notification.findOne({
        sender: req.user._id,
        recipient: req.params.id,
        type: "FOLLOW_REQUEST",
        status: "PENDING",
      });
      followStatus = isFollowing ? "following" : pending ? "requested" : "follow";

      commonFollowers = profileUser.followers?.filter((f) =>
        currentUser.followers?.some((cf) => cf._id.equals(f._id)) || false
      ) || [];
    }

    renderProfile(res, req.user, profileUser, blogsWithComments, isFollowing, followStatus, commonFollowers, {
      success_msg: req.query.success_msg,
      error_msg: req.query.error_msg,
    });
  } catch (err) {
    console.error("Error loading profile for ID:", req.params.id, err);
    renderProfile(res, req.user, null, [], false, "follow", [], { error_msg: "Failed to load profile" });
  }
});

// POST /profile (update profile)
router.post("/", cloudinaryUpload.single("profileImage"), async (req, res) => {
  try {
    if (!req.user) {
      return res.redirect("/user/signin?error_msg=Please log in to update your profile");
    }

    const { fullname, email, password, bio } = req.body;
    const update = {};

    if (fullname?.trim()) {
      if (fullname.trim().length < 2) {
        return res.redirect("/profile?error_msg=Full name must be at least 2 characters");
      }
      update.fullname = fullname.trim();
    }

    if (email?.trim()) {
      const e = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return res.redirect("/profile?error_msg=Invalid email format");
      }
      const exists = await User.findOne({ email: e, _id: { $ne: req.user._id } });
      if (exists) return res.redirect("/profile?error_msg=Email already in use");
      update.email = e;
    }

    if (password) {
      if (password.length < 6) {
        return res.redirect("/profile?error_msg=Password must be at least 6 characters");
      }
      const salt = randomBytes(16).toString("hex");
      update.salt = salt;
      update.password = createHmac("sha256", salt).update(password).digest("hex");
    }

    if (req.file) {
      update.profileImageURL = req.file.path; // Cloudinary url
    }

    if (bio?.trim()) {
      update.bio = bio.trim();
    }

    if (!Object.keys(update).length) {
      return res.redirect("/profile?error_msg=No changes provided");
    }

    const updatedUser = await User.findByIdAndUpdate(req.user._id, update, { new: true });
    if (!updatedUser) return res.redirect("/profile?error_msg=User not found");

    const token = createTokenForUser(updatedUser);
    res.cookie("token", token, { httpOnly: true });
    return res.redirect("/profile?success_msg=Profile updated successfully");
  } catch (err) {
    console.error("Error updating profile:", err);
    return res.redirect("/profile?error_msg=Failed to update profile");
  }
});

module.exports = router;
