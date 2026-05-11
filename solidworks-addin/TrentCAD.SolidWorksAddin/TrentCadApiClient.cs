using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;
using System.Threading.Tasks;
using TrentCAD.SolidWorksAddin.Models;

namespace TrentCAD.SolidWorksAddin
{
    public class TrentCadApiClient
    {
        private static readonly HttpClient Client = new HttpClient(
            new HttpClientHandler { UseProxy = false, Proxy = null, UseDefaultCredentials = false })
        {
            Timeout = TimeSpan.FromSeconds(10)
        };

        private readonly string _baseUrl;
        private string _projectRoot;

        public TrentCadApiClient(int port = 42129)
        {
            _baseUrl = $"http://127.0.0.1:{port}";
        }

        public string ToRelativePath(string absolutePath)
        {
            if (string.IsNullOrEmpty(_projectRoot) || string.IsNullOrEmpty(absolutePath))
                return absolutePath;

            var normalized = absolutePath.Replace("\\", "/");
            var root = _projectRoot.Replace("\\", "/").TrimEnd('/') + "/";

            if (normalized.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                return normalized.Substring(root.Length);

            return absolutePath;
        }

        public string ToAbsolutePath(string relativePath)
        {
            if (string.IsNullOrEmpty(_projectRoot) || string.IsNullOrEmpty(relativePath))
                return relativePath;
            return System.IO.Path.Combine(
                _projectRoot,
                relativePath.Replace("/", System.IO.Path.DirectorySeparatorChar.ToString()));
        }

        public async Task<HealthResponse> GetHealthAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/health");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            var health = JsonConvert.DeserializeObject<HealthResponse>(json);

            if (health?.Project?.Path != null)
                _projectRoot = health.Project.Path;

            return health;
        }

        public async Task<bool> IsConnectedAsync()
        {
            try
            {
                var health = await GetHealthAsync();
                return health?.Running == true;
            }
            catch
            {
                return false;
            }
        }

        public async Task<FileStatus> GetFileAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var encoded = Uri.EscapeDataString(relativePath);
            var response = await Client.GetAsync($"{_baseUrl}/api/file?path={encoded}");

            if (!response.IsSuccessStatusCode)
                return null;

            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<FileStatus>(json);
        }

        public async Task<ApiResult> CheckOutAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/checkout", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<ApiResult>(json);
        }

        public async Task<ApiResult> CheckInAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonConvert.SerializeObject(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/checkin", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<ApiResult>(json);
        }

        public async Task<SyncResult> SyncAsync()
        {
            var response = await Client.PostAsync($"{_baseUrl}/api/sync", new StringContent("{}", Encoding.UTF8, "application/json"));
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<SyncResult>(json);
        }

        public async Task<PublishResult> PublishAsync(string message)
        {
            var body = JsonConvert.SerializeObject(new { message });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/publish", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<PublishResult>(json);
        }

        public async Task<CreatePartResult> CreateNewPartAsync(string folder = "", string description = null)
        {
            var obj = new Dictionary<string, string> { { "folder", folder } };
            if (description != null) obj["description"] = description;
            var body = JsonConvert.SerializeObject(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-part", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreatePartResult>(json);
        }

        public async Task<CreatePartResult> CreateNewAssemblyAsync(string name, string parentFolder = "", string description = null)
        {
            var obj = new Dictionary<string, string> { { "name", name }, { "parentFolder", parentFolder } };
            if (description != null) obj["description"] = description;
            var body = JsonConvert.SerializeObject(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-assembly", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreatePartResult>(json);
        }

        public async Task<CreateSubsystemResult> CreateSubsystemAsync(string name, string parentFolder = "")
        {
            var obj = new Dictionary<string, string> { { "name", name }, { "parentFolder", parentFolder } };
            var body = JsonConvert.SerializeObject(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-subsystem", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<CreateSubsystemResult>(json);
        }

        public async Task<List<PendingCreate>> GetPendingCreatesAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/pending-creates");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<PendingCreate>>(json);
        }

        public async Task MarkPendingDoneAsync(string id)
        {
            var body = JsonConvert.SerializeObject(new { id });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            await Client.PostAsync($"{_baseUrl}/api/pending-creates/done", content);
        }

        public async Task<List<LockInfo>> GetLocksAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/locks");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<List<LockInfo>>(json);
        }
    }
}
