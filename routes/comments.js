const { Router } = require("express");
const Comment = require("../models/comments");
const Blog = require("../models/blog");
const Notification = require("../models/notification");

const router = Router();

// POST /comment/:blogId
router.post("/:blogId", async (req, res) => {
  try {
    if (!req.user) {
      if (req.isXhr) return res.status(401).json({ success: false, error: "Please log in to add a comment" });
      return res.redirect(`/blog/${req.params.blogId}?error_msg=Please log in to add a comment`);
    }

    const blog = await Blog.findById(req.params.blogId).populate("createdBy", "fullname isPrivate followers _id");
    if (!blog) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Blog not found" });
      return res.redirect(`/?error_msg=Blog not found`);
    }

    const cb = blog.createdBy;
    const canView = !cb.isPrivate || cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id));
    if (!canView) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "This blog is private" });
      return res.redirect(`/blog/${req.params.blogId}?error_msg=This blog is private`);
    }

    const comment = await Comment.create({
      content: req.body.content,
      blogId: req.params.blogId,
      createdBy: req.user._id,
      likes: [],
    });

    if (blog && !blog.createdBy._id.equals(req.user._id)) {
      await Notification.create({
        recipient: blog.createdBy._id,
        sender: req.user._id,
        type: "COMMENT",
        blogId: blog._id,
        message: `${req.user.fullname} commented on your post "${blog.title}"`,
        content: req.body.content,
        status: "UNREAD"
      });
    }

    if (req.isXhr) {
      const populatedComment = await Comment.findById(comment._id)
        .populate("createdBy", "fullname profileImageURL")
        .populate("likes", "fullname profileImageURL");
      return res.json({ success: true, newComment: populatedComment });
    }
    return res.redirect(`/blog/${req.params.blogId}?success_msg=Comment added successfully`);
  } catch (err) {
    console.error("Error adding comment:", err);
    if (req.isXhr) return res.status(500).json({ success: false, error: "Failed to add comment" });
    return res.redirect(`/blog/${req.params.blogId}?error_msg=Failed to add comment`);
  }
});

// POST /comment/reply/:parentId
router.post("/reply/:parentId", async (req, res) => {
  try {
    if (!req.user) {
      if (req.isXhr) return res.status(401).json({ success: false, error: "Please log in to reply" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Please log in to reply`);
    }
    const parent = await Comment.findById(req.params.parentId);
    if (!parent) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Parent comment not found" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Parent comment not found`);
    }

    const blog = await Blog.findById(parent.blogId).populate("createdBy", "fullname isPrivate followers _id");
    if (!blog) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Blog not found" });
      return res.redirect(`/?error_msg=Blog not found`);
    }

    const cb = blog.createdBy;
    const canView = !cb.isPrivate || cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id));
    if (!canView) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "This blog is private" });
      return res.redirect(`/blog/${parent.blogId}?error_msg=This blog is private`);
    }

    const reply = await Comment.create({
      content: req.body.content,
      blogId: parent.blogId,
      createdBy: req.user._id,
      parent: parent._id,
      likes: [],
    });

    if (!parent.createdBy.equals(req.user._id)) {
      await Notification.create({
        recipient: parent.createdBy,
        sender: req.user._id,
        type: "REPLY",
        blogId: parent.blogId,
        message: `${req.user.fullname} replied to your comment`,
        content: req.body.content,
        status: "UNREAD"
      });
    }

    if (req.isXhr) {
      const populatedReply = await Comment.findById(reply._id)
        .populate("createdBy", "fullname profileImageURL")
        .populate("likes", "fullname profileImageURL");
      return res.json({ success: true, newReply: populatedReply });
    }
    return res.redirect(`/blog/${parent.blogId}?success_msg=Reply added successfully`);
  } catch (err) {
    console.error("Error adding reply:", err);
    if (req.isXhr) return res.status(500).json({ success: false, error: "Failed to add reply" });
    return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Failed to add reply`);
  }
});

// DELETE /comment/:commentId
router.delete("/:commentId", async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId).populate({
      path: "blogId",
      populate: {
        path: "createdBy",
        select: "fullname isPrivate followers _id"
      }
    });
    if (!comment) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Comment not found" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Comment not found`);
    }

    const blog = comment.blogId;
    const cb = blog.createdBy;
    const canView = !cb.isPrivate || (req.user && (cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id))));
    if (!canView) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "This blog is private" });
      return res.redirect(`/blog/${blog._id}?error_msg=This blog is private`);
    }

    if (!req.user || !comment.createdBy.equals(req.user._id)) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "Unauthorized" });
      return res.redirect(`/blog/${comment.blogId}?error_msg=Unauthorized to delete this comment`);
    }

    await Comment.findByIdAndDelete(req.params.commentId);
    if (req.isXhr) return res.json({ success: true });
    return res.redirect(`/blog/${comment.blogId}?success_msg=Comment deleted successfully`);
  } catch (err) {
    console.error("Error deleting comment:", err);
    if (req.isXhr) return res.status(500).json({ success: false, error: "Failed to delete comment" });
    return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Failed to delete comment`);
  }
});

// POST /comment/:commentId/like
router.post("/:commentId/like", async (req, res) => {
  try {
    if (!req.user) {
      if (req.isXhr) return res.status(401).json({ success: false, error: "Please log in to like a comment" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Please log in to like a comment`);
    }

    const comment = await Comment.findById(req.params.commentId).populate({
      path: "blogId",
      populate: {
        path: "createdBy",
        select: "fullname isPrivate followers _id"
      }
    });
    if (!comment) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Comment not found" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Comment not found`);
    }

    const blog = comment.blogId;
    const cb = blog.createdBy;
    const canView = !cb.isPrivate || cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id));
    if (!canView) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "This blog is private" });
      return res.redirect(`/blog/${blog._id}?error_msg=This blog is private`);
    }

    if (comment.likes.includes(req.user._id)) {
      if (req.isXhr) return res.status(400).json({ success: false, error: "Already liked" });
      return res.redirect(`/blog/${comment.blogId}?error_msg=You have already liked this comment`);
    }

    comment.likes.push(req.user._id);
    await comment.save();
    if (req.isXhr) return res.json({ success: true, likesCount: comment.likes.length });
    return res.redirect(`/blog/${comment.blogId}?success_msg=Comment liked successfully`);
  } catch (err) {
    console.error("Error liking comment:", err);
    if (req.isXhr) return res.status(500).json({ success: false, error: "Failed to like comment" });
    return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Failed to like comment`);
  }
});

// DELETE /comment/:commentId/like
router.delete("/:commentId/like", async (req, res) => {
  try {
    if (!req.user) {
      if (req.isXhr) return res.status(401).json({ success: false, error: "Please log in to unlike a comment" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Please log in to unlike a comment`);
    }

    const comment = await Comment.findById(req.params.commentId).populate({
      path: "blogId",
      populate: {
        path: "createdBy",
        select: "fullname isPrivate followers _id"
      }
    });
    if (!comment) {
      if (req.isXhr) return res.status(404).json({ success: false, error: "Comment not found" });
      return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Comment not found`);
    }

    const blog = comment.blogId;
    const cb = blog.createdBy;
    const canView = !cb.isPrivate || cb._id.equals(req.user._id) || cb.followers.some(f => f.equals(req.user._id));
    if (!canView) {
      if (req.isXhr) return res.status(403).json({ success: false, error: "This blog is private" });
      return res.redirect(`/blog/${blog._id}?error_msg=This blog is private`);
    }

    if (!comment.likes.includes(req.user._id)) {
      if (req.isXhr) return res.status(400).json({ success: false, error: "Not liked" });
      return res.redirect(`/blog/${comment.blogId}?error_msg=You have not liked this comment`);
    }

    comment.likes = comment.likes.filter((userId) => userId.toString() !== req.user._id.toString());
    await comment.save();
    if (req.isXhr) return res.json({ success: true, likesCount: comment.likes.length });
    return res.redirect(`/blog/${comment.blogId}?success_msg=Comment unliked successfully`);
  } catch (err) {
    console.error("Error unliking comment:", err);
    if (req.isXhr) return res.status(500).json({ success: false, error: "Failed to unlike comment" });
    return res.redirect(`/blog/${req.query.blogId || ''}?error_msg=Failed to unlike comment`);
  }
});

module.exports = router;
