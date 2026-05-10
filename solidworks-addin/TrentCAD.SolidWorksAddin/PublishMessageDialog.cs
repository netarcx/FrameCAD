using System.Drawing;
using System.Windows.Forms;

namespace TrentCAD.SolidWorksAddin
{
    public class PublishMessageDialog : Form
    {
        private TextBox _txtMessage;

        public string CommitMessage => _txtMessage.Text.Trim();

        public PublishMessageDialog()
        {
            Text = "Publish Changes";
            Size = new Size(400, 180);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(49, 50, 68);
            ForeColor = Color.FromArgb(205, 214, 244);

            var lbl = new Label
            {
                Text = "What did you change?",
                Location = new Point(16, 16),
                AutoSize = true,
                Font = new Font("Segoe UI", 10f)
            };
            Controls.Add(lbl);

            _txtMessage = new TextBox
            {
                Location = new Point(16, 44),
                Size = new Size(350, 24),
                Font = new Font("Segoe UI", 10f),
                BackColor = Color.FromArgb(30, 30, 46),
                ForeColor = Color.FromArgb(205, 214, 244)
            };
            Controls.Add(_txtMessage);

            var btnCancel = new Button
            {
                Text = "Cancel",
                DialogResult = DialogResult.Cancel,
                Location = new Point(200, 84),
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(49, 50, 68),
                ForeColor = Color.FromArgb(205, 214, 244),
                Font = new Font("Segoe UI", 9f)
            };
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(69, 71, 90);
            Controls.Add(btnCancel);

            var btnPublish = new Button
            {
                Text = "Publish",
                DialogResult = DialogResult.OK,
                Location = new Point(286, 84),
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(137, 180, 250),
                ForeColor = Color.FromArgb(30, 30, 46),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            btnPublish.FlatAppearance.BorderSize = 0;
            Controls.Add(btnPublish);

            AcceptButton = btnPublish;
            CancelButton = btnCancel;
        }
    }
}
