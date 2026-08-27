//! Deterministic system-row ids (UUID v5).
//!
//! System-seeded rows (self user, parameter presets, system prompts,
//! built-in providers and their models) must carry the SAME id on every
//! device: seeds are singletons by type/name, the merge is row-wise by pk,
//! and the UI resolves built-in providers by `provider_type`. Random ids
//! split identities across devices (real-device findings: FK failures on
//! fresh joins, duplicated providers breaking the model picker).
//!
//! iOS never seeds these rows (it receives them via sync), so this module
//! is desktop-only by design.

use uuid::Uuid;

/// Single namespace for every system id label.
const NAMESPACE: uuid::Uuid = uuid::Uuid::from_u128(0x6f9619ff_8b86_d011_b42d_00c04fc964ff);

/// Derive a deterministic system id from its label, e.g.
/// `system_uuid("chatshell.preset.balanced")`.
pub fn system_uuid(label: &str) -> String {
    Uuid::new_v5(&NAMESPACE, label.as_bytes()).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_stable_across_versions_and_devices() {
        // Pinned anchors: changing the namespace or derivation silently
        // forks identities across devices built from different versions.
        assert_eq!(
            system_uuid("chatshell.test.anchor"),
            "b3f6fb80-1cb6-5594-b79a-59310e82a661"
        );
        // Verified against the converged production data: the Balanced
        // preset row carries exactly this id after the v12 convergence.
        assert_eq!(
            system_uuid("chatshell.preset.balanced"),
            "dff45d66-c129-54da-bfa5-015f23175417"
        );
    }

    #[test]
    fn ids_are_uuid_v5() {
        let id = system_uuid("chatshell.anything");
        assert_eq!(id.as_bytes()[14], b'5');
    }
}
