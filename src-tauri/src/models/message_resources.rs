use serde::{Deserialize, Serialize};

use super::attachment::UserAttachment;
use super::context::ContextEnrichment;
use super::process_step::ProcessStep;

/// All resources associated with a message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResources {
    pub attachments: Vec<UserAttachment>,
    pub contexts: Vec<ContextEnrichment>,
    pub steps: Vec<ProcessStep>,
}
