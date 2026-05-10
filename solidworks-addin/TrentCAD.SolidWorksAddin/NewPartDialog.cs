using System.Drawing;
using System.Windows.Forms;

namespace TrentCAD.SolidWorksAddin
{
    public enum NewItemType { Part, Assembly, Folder }

    public class NewPartDialog : Form
    {
        private RadioButton _rbPart;
        private RadioButton _rbAssembly;
        private RadioButton _rbFolder;
        private Label _lblName;
        private TextBox _txtName;
        private TextBox _txtDescription;
        private Button _btnCancel;
        private Button _btnCreate;

        public NewItemType SelectedType => _rbFolder.Checked ? NewItemType.Folder : _rbAssembly.Checked ? NewItemType.Assembly : NewItemType.Part;
        public string ItemName => _txtName.Text.Trim();
        public string Description => _txtDescription.Text.Trim();

        public NewPartDialog()
        {
            Text = "Create New";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(28, 31, 38);
            ForeColor = Color.FromArgb(220, 223, 230);
            Font = new Font("Segoe UI", 9.75f);

            _rbPart = new RadioButton
            {
                Text = "Part",
                Checked = true,
                Location = new Point(20, 20),
                AutoSize = true,
                ForeColor = Color.FromArgb(220, 223, 230),
                FlatStyle = FlatStyle.Flat
            };
            _rbPart.CheckedChanged += (s, e) => LayoutFields();
            Controls.Add(_rbPart);

            _rbAssembly = new RadioButton
            {
                Text = "Assembly",
                Location = new Point(100, 20),
                AutoSize = true,
                ForeColor = Color.FromArgb(220, 223, 230),
                FlatStyle = FlatStyle.Flat
            };
            _rbAssembly.CheckedChanged += (s, e) => LayoutFields();
            Controls.Add(_rbAssembly);

            _rbFolder = new RadioButton
            {
                Text = "Folder",
                Location = new Point(200, 20),
                AutoSize = true,
                ForeColor = Color.FromArgb(220, 223, 230),
                FlatStyle = FlatStyle.Flat
            };
            _rbFolder.CheckedChanged += (s, e) => LayoutFields();
            Controls.Add(_rbFolder);

            _lblName = new Label
            {
                Text = "Folder name",
                ForeColor = Color.FromArgb(160, 165, 180),
                Font = new Font("Segoe UI", 8.25f),
                AutoSize = true,
                Visible = false
            };
            Controls.Add(_lblName);

            _txtName = new TextBox
            {
                Size = new Size(310, 26),
                BackColor = Color.FromArgb(40, 44, 52),
                ForeColor = Color.FromArgb(220, 223, 230),
                BorderStyle = BorderStyle.FixedSingle,
                Visible = false
            };
            Controls.Add(_txtName);

            var lblDesc = new Label
            {
                Text = "Description",
                ForeColor = Color.FromArgb(160, 165, 180),
                Font = new Font("Segoe UI", 8.25f),
                AutoSize = true
            };
            Controls.Add(lblDesc);
            lblDesc.Tag = "descLabel";

            _txtDescription = new TextBox
            {
                Size = new Size(310, 26),
                BackColor = Color.FromArgb(40, 44, 52),
                ForeColor = Color.FromArgb(220, 223, 230),
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(_txtDescription);

            _btnCancel = new Button
            {
                Text = "Cancel",
                DialogResult = DialogResult.Cancel,
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(40, 44, 52),
                ForeColor = Color.FromArgb(220, 223, 230)
            };
            _btnCancel.FlatAppearance.BorderColor = Color.FromArgb(53, 58, 69);
            _btnCancel.FlatAppearance.MouseOverBackColor = Color.FromArgb(53, 58, 69);
            Controls.Add(_btnCancel);

            _btnCreate = new Button
            {
                Text = "Create",
                DialogResult = DialogResult.OK,
                Size = new Size(80, 30),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(167, 139, 250),
                ForeColor = Color.FromArgb(28, 31, 38),
                Font = new Font("Segoe UI Semibold", 9.75f)
            };
            _btnCreate.FlatAppearance.BorderSize = 0;
            _btnCreate.FlatAppearance.MouseOverBackColor = Color.FromArgb(196, 181, 253);
            Controls.Add(_btnCreate);

            AcceptButton = _btnCreate;
            CancelButton = _btnCancel;
            LayoutFields();
        }

        private void LayoutFields()
        {
            var showName = _rbAssembly.Checked || _rbFolder.Checked;
            var showDesc = !_rbFolder.Checked;
            _lblName.Visible = showName;
            _txtName.Visible = showName;
            _lblName.Text = _rbFolder.Checked ? "Folder name" : "Folder name";

            var y = 52;
            if (showName)
            {
                _lblName.Location = new Point(20, y);
                y += 18;
                _txtName.Location = new Point(20, y);
                y += 36;
            }

            foreach (Control c in Controls)
            {
                if (c.Tag as string == "descLabel")
                {
                    c.Visible = showDesc;
                    c.Location = new Point(20, y);
                    break;
                }
            }
            _txtDescription.Visible = showDesc;
            if (showDesc)
            {
                y += 18;
                _txtDescription.Location = new Point(20, y);
                y += 44;
            }

            _btnCancel.Location = new Point(164, y);
            _btnCreate.Location = new Point(250, y);
            y += 42;

            ClientSize = new Size(350, y);
        }
    }
}
