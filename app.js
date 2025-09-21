require('dotenv').config();
const express = require("express");
const http = require('http');
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const path = require("path");
const cookieParser = require("cookie-parser");
const methodOverride = require("method-override");
const moment = require("moment");

const settingsRoute = require("./routes/settings");
const userRoute = require("./routes/user");
const blogRoute = require("./routes/blog");
const commentRoute = require("./routes/comments");
const profileRoute = require("./routes/profile");
const notificationRoute = require("./routes/notification");
const { checkForAuthenticationCookie } = require("./middlewares/auth");
const { verifyToken } = require("./services/authentication");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.io = io;

const PORT = process.env.PORT || 8000;

// Validate environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'EMAIL_USER',
  'EMAIL_PASS'
];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is missing`);
    process.exit(1);
  }
});

// Debug: Log environment variables (mask sensitive info)
console.log('MONGODB_URI:', process.env.MONGODB_URI);
console.log('PORT:', PORT);
console.log('JWT_SECRET:', process.env.JWT_SECRET);
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', '****'); // Mask password

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI, { dbName: 'test' })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Socket.io authentication
io.use((socket, next) => {
  const cookie = socket.handshake.headers.cookie;
  if (cookie) {
    const tokenCookie = cookie.split('; ').find(row => row.startsWith('token='));
    if (tokenCookie) {
      const token = tokenCookie.split('=')[1];
      try {
        const userPayload = verifyToken(token);
        socket.user = userPayload;
        return next();
      } catch (err) {}
    }
  }
  next(new Error('Authentication error'));
});

io.on('connection', (socket) => {
  if (socket.user) {
    socket.join(socket.user._id.toString());
    console.log(`User connected: ${socket.user._id}`);
  }
});

// Middleware to detect XHR
app.use((req, res, next) => {
  req.isXhr = req.headers['x-requested-with'] === 'XMLHttpRequest';
  next();
});

// Middleware
app.use(methodOverride("_method"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(checkForAuthenticationCookie("token"));
app.use(express.static(path.resolve("./public")));

// View Engine
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

// Global Variables
app.locals.moment = moment;

// Error Handling Utility
const renderWithError = (res, view, data, errorMsg) => {
  console.error(`Error in ${view}:`, errorMsg);
  return res.render(view, { ...data, error_msg: errorMsg, success_msg: null });
};

// Home Route
app.get("/", async (req, res) => {
  try {
    const Blog = require("./models/blog");
    const Comment = require("./models/comments");
    const Notification = require("./models/notification");
    const User = require("./models/user");

    // Fetch all blogs, populate, then filter in JS (fix for invalid query)
    let allBlogs = await Blog.find({})
      .populate("createdBy", "fullname email profileImageURL followers isPrivate")
      .populate("likes", "fullname profileImageURL")
      .sort({ createdAt: -1 });

    allBlogs = allBlogs.filter(blog => {
      const cb = blog.createdBy;
      if (!req.user) {
        return !cb.isPrivate;
      }
      return !cb.isPrivate ||
        cb._id.equals(req.user._id) ||
        (cb.isPrivate && cb.followers?.some(f => f.equals(req.user._id)));
    });

    const currentUser = req.user ? await User.findById(req.user._id).populate("following", "fullname profileImageURL _id") : null; // Populate following for likes status

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

        const isFollowing = req.user
          ? blog.createdBy.followers?.some((follower) => follower.equals(req.user._id)) || false
          : false;
        const isOwn = req.user ? blog.createdBy._id.equals(req.user._id) : false;
        const pendingRequest = req.user
          ? await Notification.findOne({
              sender: req.user._id,
              recipient: blog.createdBy._id,
              type: "FOLLOW_REQUEST",
              status: "PENDING",
            })
          : null;
        const followStatus = isOwn ? "own" : isFollowing ? "following" : pendingRequest ? "requested" : "follow"; // Added "own" for consistency

        let likesWithStatus = blog.likes.map(liker => ({
          ...liker._doc,
          followStatus: isOwn ? "own" : "follow" // Default
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

        return { ...blog._doc, comments, totalComments, isFollowing, isOwn, followStatus, likes: likesWithStatus };
      })
    );

    res.render("home", {
      user: req.user || null,
      blogs: blogsWithComments,
      success_msg: req.query.success_msg || null,
      error_msg: req.query.error_msg || null,
    });
  } catch (err) {
    renderWithError(res, "home", { user: req.user || null, blogs: [] }, "Failed to load blogs");
  }
});

// Search Route
app.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    const queryStr = q ? q.trim() : "";
    let users = [];
    let blogs = [];

    if (queryStr) {
      const User = require("./models/user");
      const Blog = require("./models/blog");
      const Comment = require("./models/comments");
      const Notification = require("./models/notification");

      users = await User.find({
        $or: [
          { fullname: { $regex: queryStr, $options: "i" } },
          { email: { $regex: queryStr, $options: "i" } },
        ],
      })
        .populate("followers", "fullname profileImageURL")
        .sort({ fullname: 1 });

      const currentUser = req.user ? await User.findById(req.user._id).populate("following", "fullname profileImageURL _id") : null;

      const usersWithStatus = await Promise.all(
        users.map(async (u) => {
          const isOwn = req.user ? u._id.equals(req.user._id) : false;
          const isFollowing = req.user ? u.followers.some((f) => f.equals(req.user._id)) : false;
          const pendingRequest = req.user
            ? await Notification.findOne({
                sender: req.user._id,
                recipient: u._id,
                type: "FOLLOW_REQUEST",
                status: "PENDING",
              })
            : null;
          const followStatus = isOwn ? "own" : isFollowing ? "following" : pendingRequest ? "requested" : "follow";
          return { ...u._doc, isOwn, followStatus };
        })
      );

      // Fetch matching blogs, populate, then filter visibility
      let allBlogs = await Blog.find({
        $or: [
          { title: { $regex: queryStr, $options: "i" } },
          { body: { $regex: queryStr, $options: "i" } },
        ],
      })
        .populate("createdBy", "fullname profileImageURL followers isPrivate")
        .populate("likes", "fullname profileImageURL")
        .sort({ createdAt: -1 });

      allBlogs = allBlogs.filter(blog => {
        const cb = blog.createdBy;
        if (!req.user) {
          return !cb.isPrivate;
        }
        return !cb.isPrivate ||
          cb._id.equals(req.user._id) ||
          (cb.isPrivate && cb.followers?.some(f => f.equals(req.user._id)));
      });

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

          const isFollowing = req.user
            ? blog.createdBy.followers?.some((follower) => follower.equals(req.user._id)) || false
            : false;
          const isOwn = req.user ? blog.createdBy._id.equals(req.user._id) : false;
          const pendingRequest = req.user
            ? await Notification.findOne({
                sender: req.user._id,
                recipient: blog.createdBy._id,
                type: "FOLLOW_REQUEST",
                status: "PENDING",
              })
            : null;
          const followStatus = isOwn ? "own" : isFollowing ? "following" : pendingRequest ? "requested" : "follow";

          let likesWithStatus = blog.likes.map(liker => ({
            ...liker._doc,
            followStatus: isOwn ? "own" : "follow" // Default
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

          return { ...blog._doc, comments, totalComments, isFollowing, isOwn, followStatus, likes: likesWithStatus };
        })
      );

      res.render("search", {
        user: req.user || null,
        currentUser: req.user || null,
        users: usersWithStatus,
        blogs: blogsWithComments,
        query: queryStr,
        success_msg: req.query.success_msg || null,
        error_msg: req.query.error_msg || null,
      });
    } else {
      res.render("search", {
        user: req.user || null,
        currentUser: req.user || null,
        users: [],
        blogs: [],
        query: queryStr,
        success_msg: req.query.success_msg || null,
        error_msg: req.query.error_msg || null,
      });
    }
  } catch (err) {
    console.error("Error in search:", err);
    renderWithError(res, "search", { user: req.user || null, currentUser: req.user || null, users: [], blogs: [], query: "" }, "Failed to load search results");
  }
});

// Routes
app.use("/user", userRoute);
app.use("/blog", blogRoute);
app.use("/comment", commentRoute);
app.use("/profile", profileRoute);
app.use("/settings", settingsRoute);
app.use("/notification", notificationRoute);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).send("404 Not Found");
});

// Uncaught Exception Handler
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Start Server
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));

module.exports = app;
