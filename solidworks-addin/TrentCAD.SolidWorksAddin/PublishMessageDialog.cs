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
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(28, 31, 38);
            ForeColor = Color.FromArgb(220, 223, 230);
            Font = new Font("Segoe UI", 9.75f);

            var lbl = new Label
            {
                Text = "What changed?",
                ForeColor = Color.FromArgb(160, 165, 180),
                Font = new Font("Segoe UI", 8.25f),
                Location = new Point(20, 20),
                AutoSize = true
            };
            Controls.Add(lbl);

            _txtMessage = new TextBox
            {
                Location = new Point(20, 40),
                Size = new Size(310, 26),
                BackColor = Color.FromArgb(40, 44, 52),
                ForeColor = Color.FromArgb(220, 223, 230),
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(_txtMessage);

            var btnCancel = new Button
            {
                Text = "Cancel",
                DialogResult = DialogResult.Cancel,
                Location = new Point(164, 80),
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(40, 44, 52),
                ForeColor = Color.FromArgb(220, 223, 230)
            };
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(53, 58, 69);
            btnCancel.FlatAppearance.MouseOverBackColor = Color.FromArgb(53, 58, 69);
            Controls.Add(btnCancel);

            var btnPublish = new Button
            {
                Text = "Publish",
                DialogResult = DialogResult.OK,
                Location = new Point(250, 80),
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(167, 139, 250),
                ForeColor = Color.FromArgb(28, 31, 38),
                Font = new Font("Segoe UI Semibold", 9.75f)
            };
            btnPublish.FlatAppearance.BorderSize = 0;
            btnPublish.FlatAppearance.MouseOverBackColor = Color.FromArgb(196, 181, 253);
            Controls.Add(btnPublish);

            AcceptButton = btnPublish;
            CancelButton = btnCancel;
            ClientSize = new Size(350, 122);
        }
    }
}
