const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    // Configure email transporter based on environment
    const emailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      // Add connection timeout settings
      connectionTimeout: 60000, // 60 seconds
      greetingTimeout: 30000,   // 30 seconds
      socketTimeout: 60000,     // 60 seconds
      // Add pool settings for better connection management
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // Add retry settings
      retryDelay: 5000,
      // Add TLS options for better compatibility
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      }
    };

    // For development, you can use Ethereal Email for testing
    if (process.env.NODE_ENV === 'development' && !process.env.SMTP_USER) {
      console.log('⚠️ SMTP credentials not configured. Using development mode.');
      // In development without SMTP, we'll just log the email
      this.transporter = {
        sendMail: async (options) => {
          console.log('📧 Email would be sent:', {
            to: options.to,
            subject: options.subject,
            text: options.text
          });
          return { messageId: 'dev-' + Date.now() };
        }
      };
      return;
    }

    try {
      this.transporter = nodemailer.createTransport(emailConfig);
      console.log('✅ Email service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize email service:', error);
      // Fallback to console logging in production if email fails
      this.transporter = {
        sendMail: async (options) => {
          console.log('📧 Email fallback (SMTP failed):', {
            to: options.to,
            subject: options.subject,
            text: options.text
          });
          return { messageId: 'fallback-' + Date.now() };
        }
      };
    }
  }

  async sendPasswordResetEmail(userEmail, userName, resetToken, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds
    
    try {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
      
      const mailOptions = {
        from: `"${process.env.APP_NAME || 'ByteCloud'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: userEmail,
        subject: 'Password Reset Request - ByteCloud',
        text: this.generatePasswordResetTextEmail(userName, resetUrl),
        html: this.generatePasswordResetHtmlEmail(userName, resetUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Password reset email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send password reset email (attempt ' + (retryCount + 1) + '):', error.code || error.message);
      
      // Retry on connection timeouts or network errors
      if (retryCount < maxRetries && (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED')) {
        console.log(`🔄 Retrying email send in ${retryDelay/1000} seconds... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.sendPasswordResetEmail(userEmail, userName, resetToken, retryCount + 1);
      }
      
      throw new Error('Failed to send password reset email after ' + (retryCount + 1) + ' attempts');
    }
  }

  generatePasswordResetTextEmail(userName, resetUrl) {
    return `
Hello ${userName},

You have requested a password reset for your ByteCloud account.

To reset your password, please click on the following link:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you did not request this password reset, please ignore this email and your password will remain unchanged.

Best regards,
The ByteCloud Team

---
This is an automated email. Please do not reply to this message.
    `.trim();
  }

  generatePasswordResetHtmlEmail(userName, resetUrl) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset - ByteCloud</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .container {
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background: #3b82f6;
            color: white;
            padding: 30px 40px;
            text-align: center;
        }
        .content {
            padding: 40px;
        }
        .button {
            display: inline-block;
            background: #3b82f6;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 20px 0;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px 40px;
            text-align: center;
            font-size: 12px;
            color: #6b7280;
        }
        .warning {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Password Reset Request</h1>
        </div>
        <div class="content">
            <h2>Hello ${userName},</h2>
            <p>You have requested a password reset for your ByteCloud account.</p>
            <p>To reset your password, please click the button below:</p>
            
            <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset My Password</a>
            </div>
            
            <div class="warning">
                <strong>⚠️ Security Notice:</strong><br>
                This link will expire in <strong>1 hour</strong> for security reasons.
            </div>
            
            <p>If you did not request this password reset, please ignore this email and your password will remain unchanged.</p>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #3b82f6;">${resetUrl}</p>
        </div>
        <div class="footer">
            <p>Best regards,<br>The ByteCloud Team</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 15px 0;">
            <p>This is an automated email. Please do not reply to this message.</p>
        </div>
    </div>
</body>
</html>
    `.trim();
  }

  async sendWelcomeEmail(userEmail, userName) {
    try {
      const mailOptions = {
        from: `"${process.env.APP_NAME || 'ByteCloud'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: userEmail,
        subject: 'Welcome to ByteCloud!',
        text: `Hello ${userName},\n\nWelcome to ByteCloud! Your account has been created successfully.\n\nYou can now start uploading and sharing your files securely.\n\nBest regards,\nThe ByteCloud Team`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #3b82f6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Welcome to ByteCloud!</h1>
        </div>
        <div class="content">
            <h2>Hello ${userName},</h2>
            <p>Welcome to ByteCloud! Your account has been created successfully.</p>
            <p>You can now start uploading and sharing your files securely with our cloud storage platform.</p>
            <p>Thank you for choosing ByteCloud!</p>
            <p>Best regards,<br>The ByteCloud Team</p>
        </div>
    </div>
</body>
</html>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Welcome email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send welcome email:', error);
      // Don't throw error for welcome email failure - it's not critical
      return null;
    }
  }

  async verifyConnection() {
    try {
      if (this.transporter.verify) {
        await this.transporter.verify();
        console.log('✅ Email service connection verified');
        return true;
      }
      return true; // For fallback transporter
    } catch (error) {
      console.error('❌ Email service connection failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();