using System.Drawing;
using System.Windows.Forms;

namespace TrentCAD.SolidWorksAddin
{
    public enum NewItemType { Part, Assembly }

    public class NewPartDialog : Form
    {
        private RadioButton _rbPart;
        private RadioButton _rbAssembly;
        private Label _lblName;
        private TextBox _txtName;
        private TextBox _txtDescription;
        private Button _btnCancel;
        private Button _btnCreate;

        public NewItemType SelectedType => _rbAssembly.Checked ? NewItemType.Assembly : NewItemType.Part;
        public string ItemName => _txtName.Text.Trim();
        public string Description => _txtDescription.Text.Trim();

        public NewPartDialog()
        {
            Text = "Create New";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(30, 30, 46);
            ForeColor = Color.FromArgb(205, 214, 244);
            Font = new Font("Segoe UI", 9.75f);

            _rbPart = new RadioButton
            {
                Text = "Part",
                Checked = true,
                Location = new Point(20, 20),
                AutoSize = true,
                ForeColor = Color.FromArgb(205, 214, 244),
                FlatStyle = FlatStyle.Flat
            };
            _rbPart.CheckedChanged += (s, e) => LayoutFields();
            Controls.Add(_rbPart);

            _rbAssembly = new RadioButton
            {
                Text = "Assembly",
                Location = new Point(100, 20),
                AutoSize = true,
                ForeColor = Color.FromArgb(205, 214, 244),
                FlatStyle = FlatStyle.Flat
            };
            Controls.Add(_rbAssembly);

            _lblName = new Label
            {
                Text = "Folder name",
                ForeColor = Color.FromArgb(166, 173, 200),
                Font = new Font("Segoe UI", 8.25f),
                AutoSize = true,
                Visible = false
            };
            Controls.Add(_lblName);

            _txtName = new TextBox
            {
                Size = new Size(310, 26),
                BackColor = Color.FromArgb(49, 50, 68),
                ForeColor = Color.FromArgb(205, 214, 244),
                BorderStyle = BorderStyle.FixedSingle,
                Visible = false
            };
            Controls.Add(_txtName);

            var lblDesc = new Label
            {
                Text = "Description",
                ForeColor = Color.FromArgb(166, 173, 200),
                Font = new Font("Segoe UI", 8.25f),
                AutoSize = true
            };
            Controls.Add(lblDesc);
            lblDesc.Tag = "descLabel";

            _txtDescription = new TextBox
            {
                Size = new Size(310, 26),
                BackColor = Color.FromArgb(49, 50, 68),
                ForeColor = Color.FromArgb(205, 214, 244),
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(_txtDescription);

            _btnCancel = new Button
            {
                Text = "Cancel",
                DialogResult = DialogResult.Cancel,
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(49, 50, 68),
                ForeColor = Color.FromArgb(205, 214, 244)
            };
            _btnCancel.FlatAppearance.BorderColor = Color.FromArgb(69, 71, 90);
            _btnCancel.FlatAppearance.MouseOverBackColor = Color.FromArgb(69, 71, 90);
            Controls.Add(_btnCancel);

            _btnCreate = new Button
            {
                Text = "Create",
                DialogResult = DialogResult.OK,
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(137, 180, 250),
                ForeColor = Color.FromArgb(30, 30, 46),
                Font = new Font("Segoe UI Semibold", 9.75f)
            };
            _btnCreate.FlatAppearance.BorderSize = 0;
            _btnCreate.FlatAppearance.MouseOverBackColor = Color.FromArgb(116, 162, 234);
            Controls.Add(_btnCreate);

            AcceptButton = _btnCreate;
            CancelButton = _btnCancel;
            LayoutFields();
        }

        private void LayoutFields()
        {
            var showName = _rbAssembly.Checked;
            _lblName.Visible = showName;
            _txtName.Visible = showName;

            var y = 52;
            if (showName)
            {
                _lblName.Location = new Point(20, y);
                y += 18;
                _txtName.Location = new Point(20, y);
                y += 36;
            }

            var descLabel = Controls.Find("descLabel", false);
            if (descLabel.Length == 0)
            {
                foreach (Control c in Controls)
                    if (c.Tag as string == "descLabel") { c.Location = new Point(20, y); break; }
            }
            else
            {
                descLabel[0].Location = new Point(20, y);
            }
            y += 18;
            _txtDescription.Location = new Point(20, y);
            y += 44;

            _btnCancel.Location = new Point(164, y);
            _btnCreate.Location = new Point(250, y);
            y += 42;

            ClientSize = new Size(350, y);
        }
    }
}
