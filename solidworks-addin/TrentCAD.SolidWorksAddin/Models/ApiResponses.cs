using System.Text.Json.Serialization;

namespace TrentCAD.SolidWorksAddin.Models
{
    public class HealthResponse
    {
        [JsonPropertyName("running")]
        public bool Running { get; set; }

        [JsonPropertyName("project")]
        public ProjectInfo Project { get; set; }
    }

    public class ProjectInfo
    {
        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("remote")]
        public string Remote { get; set; }
    }

    public class ApiResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class SyncResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("filesUpdated")]
        public int FilesUpdated { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class PublishResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("hash")]
        public string Hash { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class CreatePartResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("partNumber")]
        public string PartNumber { get; set; }

        [JsonPropertyName("filePath")]
        public string FilePath { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class CreateSubsystemResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("folderPath")]
        public string FolderPath { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class LockInfo
    {
        [JsonPropertyName("path")]
        public string Path { get; set; }

        [JsonPropertyName("owner")]
        public string Owner { get; set; }

        [JsonPropertyName("id")]
        public string Id { get; set; }
    }
}
