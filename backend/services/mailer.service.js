const nodemailer = require("nodemailer");
const config = require("../config");

const hasSmtpConfig = () =>
  Boolean(
    config.smtp.host?.trim() &&
      config.smtp.user?.trim() &&
      config.smtp.pass?.trim()
  );

const getTransporter = () => {
  if (!hasSmtpConfig()) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass.replace(/\s+/g, ""),
    },
  });
};

const sendPasswordResetOtp = async (toEmail, otp) => {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      `SMTP not configured. OTP for ${toEmail}: ${otp}. Add SMTP_* vars to backend/.env and restart the backend server.`
    );
    return { sent: false, devOtp: otp };
  }

  try {
    await transporter.sendMail({
      from: config.smtp.from,
      to: toEmail,
      subject: "OpsAi password reset OTP",
      text: `Your OTP is ${otp}. It expires in ${config.otp.expiresMinutes} minutes.`,
    });
    console.info(`Password reset OTP email sent to ${toEmail}`);
    return { sent: true };
  } catch (error) {
    console.error(`Failed to send OTP email to ${toEmail}:`, error.message);
    throw error;
  }
};

module.exports = { sendPasswordResetOtp, hasSmtpConfig };
