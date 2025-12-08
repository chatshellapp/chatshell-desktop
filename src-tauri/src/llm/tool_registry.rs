//! Tool registry module for managing and registering tools with LLM agents.
//!
//! This module provides a centralized way to define and register tools that can be used
//! by agents across different providers. It handles tool definitions, schemas, and registration.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

/// Represents a tool parameter definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolParameter {
    /// Parameter name
    pub name: String,
    /// Parameter type (e.g., "string", "number", "boolean", "object", "array")
    pub param_type: String,
    /// Parameter description
    pub description: String,
    /// Whether this parameter is required
    pub required: bool,
    /// Optional enum values for the parameter
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
}

/// Represents a tool definition that can be registered with an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Tool name (must be unique)
    pub name: String,
    /// Tool description
    pub description: String,
    /// Tool parameters
    pub parameters: Vec<ToolParameter>,
    /// Tool category (e.g., "web", "file", "search", "database")
    #[serde(default)]
    pub category: String,
}

impl ToolDefinition {
    /// Create a new tool definition
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            parameters: Vec::new(),
            category: String::new(),
        }
    }

    /// Add a parameter to the tool
    pub fn with_parameter(mut self, param: ToolParameter) -> Self {
        self.parameters.push(param);
        self
    }

    /// Set the tool category
    pub fn with_category(mut self, category: impl Into<String>) -> Self {
        self.category = category.into();
        self
    }

    /// Convert to OpenAI function calling format
    pub fn to_openai_function(&self) -> Value {
        let mut properties = serde_json::Map::new();
        let mut required_params = Vec::new();

        for param in &self.parameters {
            let mut param_schema = serde_json::Map::new();
            param_schema.insert("type".to_string(), json!(param.param_type));
            param_schema.insert("description".to_string(), json!(param.description));

            if let Some(ref enum_values) = param.enum_values {
                param_schema.insert("enum".to_string(), json!(enum_values));
            }

            properties.insert(param.name.clone(), Value::Object(param_schema));

            if param.required {
                required_params.push(param.name.clone());
            }
        }

        json!({
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required_params
                }
            }
        })
    }
}

impl ToolParameter {
    /// Create a new required parameter
    pub fn required(
        name: impl Into<String>,
        param_type: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            param_type: param_type.into(),
            description: description.into(),
            required: true,
            enum_values: None,
        }
    }

    /// Create a new optional parameter
    pub fn optional(
        name: impl Into<String>,
        param_type: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            param_type: param_type.into(),
            description: description.into(),
            required: false,
            enum_values: None,
        }
    }

    /// Add enum values to the parameter
    pub fn with_enum(mut self, values: Vec<String>) -> Self {
        self.enum_values = Some(values);
        self
    }
}

/// Registry for managing available tools
#[derive(Debug, Clone, Default)]
pub struct ToolRegistry {
    /// Map of tool name to tool definition
    tools: HashMap<String, ToolDefinition>,
}

impl ToolRegistry {
    /// Create a new empty tool registry
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a registry with default tools
    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register_default_tools();
        registry
    }

    /// Register a tool definition
    pub fn register(&mut self, tool: ToolDefinition) -> Result<()> {
        if self.tools.contains_key(&tool.name) {
            anyhow::bail!("Tool '{}' is already registered", tool.name);
        }
        self.tools.insert(tool.name.clone(), tool);
        Ok(())
    }

    /// Get a tool definition by name
    pub fn get(&self, name: &str) -> Option<&ToolDefinition> {
        self.tools.get(name)
    }

    /// Get all tool definitions
    pub fn all(&self) -> Vec<&ToolDefinition> {
        self.tools.values().collect()
    }

    /// Get tools by category
    pub fn by_category(&self, category: &str) -> Vec<&ToolDefinition> {
        self.tools
            .values()
            .filter(|tool| tool.category == category)
            .collect()
    }

    /// Convert all tools to OpenAI function calling format
    pub fn to_openai_functions(&self) -> Vec<Value> {
        self.tools
            .values()
            .map(|tool| tool.to_openai_function())
            .collect()
    }

    /// Convert selected tools to OpenAI function calling format
    pub fn to_openai_functions_by_names(&self, names: &[String]) -> Vec<Value> {
        names
            .iter()
            .filter_map(|name| self.tools.get(name))
            .map(|tool| tool.to_openai_function())
            .collect()
    }

    /// Register default tools (web search, file operations, etc.)
    fn register_default_tools(&mut self) {
        // Web search tool
        let web_search = ToolDefinition::new(
            "web_search",
            "Search the web for information using a search engine",
        )
        .with_category("web")
        .with_parameter(ToolParameter::required(
            "query",
            "string",
            "The search query to execute",
        ))
        .with_parameter(ToolParameter::optional(
            "max_results",
            "number",
            "Maximum number of results to return (default: 5)",
        ));

        // Web fetch tool
        let web_fetch =
            ToolDefinition::new("web_fetch", "Fetch and extract content from a web page")
                .with_category("web")
                .with_parameter(ToolParameter::required(
                    "url",
                    "string",
                    "The URL of the web page to fetch",
                ));

        // File read tool
        let file_read = ToolDefinition::new(
            "file_read",
            "Read the contents of a file from the filesystem",
        )
        .with_category("file")
        .with_parameter(ToolParameter::required(
            "path",
            "string",
            "The path to the file to read",
        ));

        // File write tool
        let file_write =
            ToolDefinition::new("file_write", "Write content to a file on the filesystem")
                .with_category("file")
                .with_parameter(ToolParameter::required(
                    "path",
                    "string",
                    "The path to the file to write",
                ))
                .with_parameter(ToolParameter::required(
                    "content",
                    "string",
                    "The content to write to the file",
                ));

        // Register all default tools (ignore errors since we're the only caller)
        let _ = self.register(web_search);
        let _ = self.register(web_fetch);
        let _ = self.register(file_read);
        let _ = self.register(file_write);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_definition_creation() {
        let tool = ToolDefinition::new("test_tool", "A test tool")
            .with_category("test")
            .with_parameter(ToolParameter::required(
                "param1",
                "string",
                "Test parameter",
            ));

        assert_eq!(tool.name, "test_tool");
        assert_eq!(tool.description, "A test tool");
        assert_eq!(tool.category, "test");
        assert_eq!(tool.parameters.len(), 1);
    }

    #[test]
    fn test_tool_registry() {
        let mut registry = ToolRegistry::new();
        let tool = ToolDefinition::new("test_tool", "A test tool");

        assert!(registry.register(tool.clone()).is_ok());
        assert!(registry.get("test_tool").is_some());
        assert!(registry.register(tool).is_err()); // Duplicate registration
    }

    #[test]
    fn test_default_tools() {
        let registry = ToolRegistry::with_defaults();
        assert!(registry.get("web_search").is_some());
        assert!(registry.get("web_fetch").is_some());
        assert!(registry.get("file_read").is_some());
        assert!(registry.get("file_write").is_some());
    }

    #[test]
    fn test_openai_function_conversion() {
        let tool = ToolDefinition::new("test_tool", "A test tool").with_parameter(
            ToolParameter::required("param1", "string", "Test parameter"),
        );

        let function = tool.to_openai_function();
        assert_eq!(function["type"], "function");
        assert_eq!(function["function"]["name"], "test_tool");
        assert!(function["function"]["parameters"]["properties"]["param1"].is_object());
    }

    #[test]
    fn test_category_filtering() {
        let mut registry = ToolRegistry::new();
        let web_tool = ToolDefinition::new("web_tool", "Web tool").with_category("web");
        let file_tool = ToolDefinition::new("file_tool", "File tool").with_category("file");

        let _ = registry.register(web_tool);
        let _ = registry.register(file_tool);

        let web_tools = registry.by_category("web");
        assert_eq!(web_tools.len(), 1);
        assert_eq!(web_tools[0].name, "web_tool");
    }
}
