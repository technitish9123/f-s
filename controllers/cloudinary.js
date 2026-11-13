const cloudinary = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Product and slider images are handled identically.
const upload = async (req, res) => {
  const result = await cloudinary.uploader.upload(req.body.image, {
    public_id: `${Date.now()}`,
    resource_type: "auto",
  });
  res.json({ public_id: result.public_id, url: result.secure_url });
};

const remove = (req, res) => {
  cloudinary.uploader.destroy(req.body.public_id, (err) => {
    if (err) return res.json({ status: false, err });
    res.send("ok");
  });
};

module.exports = { upload, remove, sliderUpload: upload, sliderRemove: remove };
