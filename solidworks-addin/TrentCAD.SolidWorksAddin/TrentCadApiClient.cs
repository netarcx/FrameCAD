using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using TrentCAD.SolidWorksAddin.Models;

namespace TrentCAD.SolidWorksAddin
{
    public class TrentCadApiClient
    {
        private static readonly HttpClient Client = new HttpClient
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

        public async Task<HealthResponse> GetHealthAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/health");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            var health = JsonSerializer.Deserialize<HealthResponse>(json);

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
            return JsonSerializer.Deserialize<FileStatus>(json);
        }

        public async Task<ApiResult> CheckOutAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonSerializer.Serialize(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/checkout", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<ApiResult>(json);
        }

        public async Task<ApiResult> CheckInAsync(string absolutePath)
        {
            var relativePath = ToRelativePath(absolutePath);
            var body = JsonSerializer.Serialize(new { path = relativePath });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/checkin", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<ApiResult>(json);
        }

        public async Task<SyncResult> SyncAsync()
        {
            var response = await Client.PostAsync($"{_baseUrl}/api/sync", new StringContent("{}", Encoding.UTF8, "application/json"));
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<SyncResult>(json);
        }

        public async Task<PublishResult> PublishAsync(string message)
        {
            var body = JsonSerializer.Serialize(new { message });
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/publish", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<PublishResult>(json);
        }

        public async Task<CreatePartResult> CreateNewPartAsync(string folder = "", string description = null)
        {
            var obj = new Dictionary<string, string> { { "folder", folder } };
            if (description != null) obj["description"] = description;
            var body = JsonSerializer.Serialize(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-part", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<CreatePartResult>(json);
        }

        public async Task<CreatePartResult> CreateNewAssemblyAsync(string name, string parentFolder = "", string description = null)
        {
            var obj = new Dictionary<string, string> { { "name", name }, { "parentFolder", parentFolder } };
            if (description != null) obj["description"] = description;
            var body = JsonSerializer.Serialize(obj);
            var content = new StringContent(body, Encoding.UTF8, "application/json");
            var response = await Client.PostAsync($"{_baseUrl}/api/parts/new-assembly", content);
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<CreatePartResult>(json);
        }

        public async Task<List<LockInfo>> GetLocksAsync()
        {
            var response = await Client.GetAsync($"{_baseUrl}/api/locks");
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<List<LockInfo>>(json);
        }
    }
}
