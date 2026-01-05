import type { Project, ProjectWithSessions } from '@/types/project'

export async function getProjects(): Promise<Project[]> {
  const response = await fetch('/api/projects')
  if (!response.ok) {
    throw new Error('Failed to fetch projects')
  }
  return response.json()
}

interface ProjectsWithThumbnailsResponse {
  data: Project[]
  nextCursor: string | null
  hasMore: boolean
}

export async function getProjectsWithThumbnails(): Promise<Project[]> {
  const response = await fetch('/api/projects/with-thumbnails')
  if (!response.ok) {
    throw new Error('Failed to fetch projects with thumbnails')
  }
  const json = await response.json() as ProjectsWithThumbnailsResponse
  return json.data
}

export async function getProject(id: string, includeSessions = false): Promise<ProjectWithSessions> {
  const url = includeSessions 
    ? `/api/projects/${id}?includeSessions=1` 
    : `/api/projects/${id}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch project')
  }
  return response.json()
}

export async function createProject(data: {
  name: string
  description?: string
}): Promise<Project> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error('Failed to create project')
  }

  return response.json()
}

export async function updateProject(
  id: string,
  data: {
    name?: string
    description?: string
    isShared?: boolean
  }
): Promise<Project> {
  const response = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    throw new Error('Failed to update project')
  }

  return response.json()
}

export async function deleteProject(id: string): Promise<void> {
  const response = await fetch(`/api/projects/${id}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error('Failed to delete project')
  }
}

