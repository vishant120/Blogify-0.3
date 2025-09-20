// models/user.js (updated with isPrivate)
const { Schema, model, models } = require("mongoose");
const { createHmac, randomBytes } = require("crypto");
const { createTokenForUser } = require("../services/authentication");

const userSchema = new Schema(
  {
    fullname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    salt: {
      type: String,
    },
    password: {
      type: String,
      required: true,
    },
    profileImageURL: {
      type: String,
      default: "/images/default.png",
    },
    role: {
      type: String,
      enum: ["USER", "ADMIN"],
      default: "USER",
    },
    following: [{ type: Schema.Types.ObjectId, ref: "User" }],
    followers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    likedBlogs: [{ type: Schema.Types.ObjectId, ref: "Blog" }],
    bio: { type: String, trim: true },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationCode: {
      type: String,
    },
    verificationCodeExpires: {
      type: Date,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", function (next) {
  if (!this.isModified("password")) return next();
  const salt = randomBytes(16).toString("hex");
  this.salt = salt;
  this.password = createHmac("sha256", salt).update(this.password).digest("hex");
  next();
});

userSchema.statics.matchPassword = async function (email, password) {
  const user = await this.findOne({ email });
  if (!user) throw new Error("User not found");
  if (!user.isVerified) throw new Error("Please verify your email before signing in");

  const salt = user.salt;
  const hashedPassword = user.password;
  const userProvidedHash = createHmac("sha256", salt).update(password).digest("hex");

  if (hashedPassword !== userProvidedHash) throw new Error("Incorrect password");
  return createTokenForUser(user);
};

const User = models.User || model("User", userSchema);

module.exports = User;
