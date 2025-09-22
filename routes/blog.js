const { Router } = require("express");
const Blog = require("../models/blog");
const Comment = require("../models/comments");
const User = require("../models/user");
const Notification = require("../models/notification");
const cloudinaryUpload = require("../middlewares/cloudinaryUpload");

const router = Router();

// GET /blog/addBlog
router.get("/addBlog", (req, res) =>
  res.render("addBlog", {
    user: req.user || null,
    error_msg: req.query.error_msg || null,
    success_msg: req.query.success_msg || null,
  })
);

// GET /blog/:id
router.get("/:id", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .populate("createdBy", "fullname email profileImageURL isPrivate followers")
      .populate("likes", "fullname profileImageURL");

    if (!blog) return res.redirect("/?error_msg=Blog not found");

    const cb = blog.createdBy;
    const canView = !cb.isPrivate || (req.user ? cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id)) : false);
    if (!canView) {
      return res.redirect("/?error_msg=This blog is private");
    }

    const comments = await Comment.find({ blogId: req.params.id, parent: null })
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

    const isFollowing = req.user ? cb.followers.some(follower => follower.equals(req.user._id)) : false;
    const isOwn = req.user ? cb._id.equals(req.user._id) : false;
    const pendingRequest = req.user ? await Notification.findOne({ sender: req.user._id, recipient: cb._id, type: "FOLLOW_REQUEST", status: "PENDING" }) : null;
    const followStatus = isOwn ? "own" : isFollowing ? "following" : pendingRequest ? "requested" : "follow";

    let likesWithStatus = blog.likes.map(liker => ({ ...liker._doc, followStatus: "follow" }));
    const currentUser = req.user ? await User.findById(req.user._id).populate("following", "fullname profileImageURL _id") : null;
    if (currentUser) {
      likesWithStatus = await Promise.all(blog.likes.map(async (liker) => {
        if (liker._id.equals(currentUser._id)) return { ...liker._doc, followStatus: "own" };
        const isFollowingLiker = currentUser.following?.some(f => f._id.equals(liker._id)) || false;
        const pendingRequestLiker = await Notification.findOne({ sender: currentUser._id, recipient: liker._id, type: "FOLLOW_REQUEST", status: "PENDING" });
        const followStatusLiker = isFollowingLiker ? "following" : pendingRequestLiker ? "requested" : "follow";
        return { ...liker._doc, followStatus: followStatusLiker };
      }));
    }

    return res.render("blog", {
      user: req.user || null,
      blog: { ...blog._doc, comments, totalComments, isFollowing, isOwn, followStatus, likes: likesWithStatus },
      error_msg: req.query.error_msg || null,
      success_msg: req.query.success_msg || null,
    });
  } catch (err) {
    console.error("Error loading blog:", err);
    return res.redirect("/?error_msg=Failed to load blog");
  }
});

// POST /blog
router.post("/", cloudinaryUpload.single("coverImage"), async (req, res) => {
  try {
    if (!req.user) return res.redirect("/blog/addBlog?error_msg=Login required");
    const { title, body } = req.body;
    const blog = await Blog.create({
      body,
      title,
      createdBy: req.user._id,
      coverImage: req.file ? req.file.path : null, // Cloudinary url
      likes: [],
    });
    return res.redirect(`/blog/${blog._id}?success_msg=Blog created`);
  } catch (err) {
    console.error("Error creating blog:", err);
    return res.redirect("/blog/addBlog?error_msg=Failed to create blog");
  }
});

// DELETE /blog/:id
router.delete("/:id", async (req, res) => {
  try {
    if (!req.user) return res.redirect("/?error_msg=Please log in to delete a blog");
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.redirect("/?error_msg=Blog not found");
    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.redirect("/?error_msg=Unauthorized to delete this blog");
    }
    await Blog.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ blogId: req.params.id });
    await Notification.deleteMany({ blogId: req.params.id });
    return res.redirect("/?success_msg=Blog deleted");
  } catch (err) {
    console.error("Error deleting blog:", err);
    return res.redirect("/?error_msg=Failed to delete blog");
  }
});

// POST /blog/:id/like
router.post("/:id/like", async (req, res) => {
  try {
    if (!req.user) {
      if (req.isXhr) return res.status(401).json({ success: false, error: "Please log in to like a blog" });
      return res.redirect(`/blog/${req.params.id}?error_msg=Please log in to like a blog`);
    }

    const blog = await Blog.findById(req.params.id).populate("createdBy", "fullname isPrivate followers _id");
    if (!blog) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Blog not found" });
      return res.redirect(`/blog/${req.params.id}?error_msg=Blog not found`);
    }

    const cb = blog.createdBy;
    const canView = !cb.isPrivate || cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id));
    if (!canView) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "This blog is private" });
      return res.redirect(`/blog/${req.params.id}?error_msg=This blog is private`);
    }

    const user = await User.findById(req.user._id);
    const isLiked = blog.likes.includes(req.user._id);

    if (isLiked) {
      blog.likes.pull(req.user._id);
      user.likedBlogs.pull(req.params.id);
      await Notification.deleteOne({
        sender: req.user._id,
        recipient: blog.createdBy._id,
        type: "LIKE",
        blogId: req.params.id,
      });
    } else {
      blog.likes.push(req.user._id);
      user.likedBlogs.push(req.params.id);

      if (blog.createdBy._id.toString() !== req.user._id.toString()) {
        const existingLikeNotification = await Notification.findOne({
          sender: req.user._id,
          recipient: blog.createdBy._id,
          type: "LIKE",
          blogId: req.params.id,
        });

        if (!existingLikeNotification) {
          await Notification.create({
            recipient: blog.createdBy._id,
            sender: req.user._id,
            type: "LIKE",
            blogId: req.params.id,
            message: `${req.user.fullname} liked your post: ${blog.title}`,
            status: "UNREAD",
          });
        }
      }
    }

    await Promise.all([blog.save(), user.save()]);

    if (req.isXhr) {
      return res.json({ success: true, isLiked: !isLiked, likesCount: blog.likes.length });
    }
    return res.redirect(`/blog/${req.params.id}?success_msg=${isLiked ? "Blog unliked" : "Blog liked"}`);
  } catch (err) {
    console.error("Error liking blog:", err);
    if (req.isXhr) return res.status(500).json({ success: false, error: "Failed to like blog" });
    return res.redirect(`/blog/${req.params.id}?error_msg=Failed to like blog`);
  }
});

module.exports = router;
