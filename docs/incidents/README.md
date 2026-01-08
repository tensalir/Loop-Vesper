# Issues Documentation

This folder contains documented issues following GitHub Issues and Linear best practices. Each issue has its own subfolder with:

1. **`issue.md`** - Comprehensive issue documentation including:
   - Summary and status
   - Environment details
   - Error details and logs
   - Steps to reproduce
   - Expected vs actual behavior
   - Root cause analysis
   - Possible solutions with priorities
   - Next steps and timeline

2. **Relevant source files** - Copies of the files involved in the issue at the time of reporting, preserving the exact code state for reference.

## Structure

```
issues/
├── README.md (this file)
└── [issue-id]-[short-description]/
    ├── issue.md
    └── [relevant source files with preserved directory structure]
```

## Naming Convention

Issue folders follow the pattern: `[error-code]-[short-description]`

Examples:
- `429-rate-limit-quota-exceeded`
- `401-unauthorized-internal-api`
- `invalid-role-vertex-api-payload`

## Purpose

This structure allows:
- Easy sharing with developers
- Preserving code state at the time of issue discovery
- Comprehensive documentation for debugging
- Reference for similar issues in the future
- Tracking issue resolution progress

## Adding a New Issue

1. Create a new folder: `issues/[issue-id]-[short-description]/`
2. Create `issue.md` following the template from existing issues
3. Copy relevant source files maintaining their directory structure
4. Update this README if needed
