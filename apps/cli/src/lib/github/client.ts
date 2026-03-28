/**
 * GitHub Issues API Client
 *
 * REST wrapper for GitHub Issues API access.
 * Uses the GitHub REST API v3 (application/vnd.github+json).
 * Auth via GITHUB_TOKEN or stored token.
 */

import type { GitHubIssue, GitHubLabel, GitHubRepo } from './types.js'

const GITHUB_API_URL = 'https://api.github.com'

export class GitHubClient {
  private token: string

  constructor(token: string) {
    this.token = token
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${GITHUB_API_URL}${path}`
    const options: RequestInit = {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GitHub API ${method} ${path} failed with status ${response.status}: ${text}`)
    }

    // DELETE returns 204 No Content
    if (response.status === 204) {
      return undefined as T
    }

    return (await response.json()) as T
  }

  /**
   * Verify the token is valid and return the authenticated user info.
   */
  async verify(): Promise<{ login: string; name: string | null }> {
    const data = await this.request<{ login: string; name: string | null }>('GET', '/user')
    return { login: data.login, name: data.name }
  }

  /**
   * Get a repository by owner and name.
   */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>('GET', `/repos/${owner}/${repo}`)
  }

  /**
   * Get a single issue by number.
   */
  async getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    return this.request<GitHubIssue>('GET', `/repos/${owner}/${repo}/issues/${issueNumber}`)
  }

  /**
   * List issues for a repository.
   */
  async listIssues(owner: string, repo: string, options?: {
    state?: 'open' | 'closed' | 'all'
    labels?: string
    assignee?: string
    milestone?: string
    per_page?: number
    page?: number
  }): Promise<GitHubIssue[]> {
    const params = new URLSearchParams()
    if (options?.state) params.set('state', options.state)
    if (options?.labels) params.set('labels', options.labels)
    if (options?.assignee) params.set('assignee', options.assignee)
    if (options?.milestone) params.set('milestone', options.milestone)
    params.set('per_page', String(options?.per_page ?? 100))
    if (options?.page) params.set('page', String(options.page))

    const qs = params.toString()
    const path = `/repos/${owner}/${repo}/issues${qs ? `?${qs}` : ''}`

    const results = await this.request<GitHubIssue[]>('GET', path)
    // Filter out pull requests (GitHub API returns PRs in issues endpoint)
    return results.filter(issue => !('pull_request' in issue))
  }

  /**
   * Create a new issue.
   */
  async createIssue(owner: string, repo: string, input: {
    title: string
    body?: string
    labels?: string[]
    assignees?: string[]
    milestone?: number
  }): Promise<GitHubIssue> {
    return this.request<GitHubIssue>('POST', `/repos/${owner}/${repo}/issues`, input)
  }

  /**
   * Update an existing issue.
   */
  async updateIssue(owner: string, repo: string, issueNumber: number, input: {
    title?: string
    body?: string
    state?: 'open' | 'closed'
    labels?: string[]
    assignees?: string[]
    milestone?: number | null
  }): Promise<GitHubIssue> {
    return this.request<GitHubIssue>('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, input)
  }

  /**
   * Add labels to an issue.
   */
  async addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<GitHubLabel[]> {
    return this.request<GitHubLabel[]>(
      'POST',
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      { labels },
    )
  }

  /**
   * Remove a label from an issue.
   */
  async removeLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    )
  }

  /**
   * List all labels for a repository.
   */
  async listRepoLabels(owner: string, repo: string): Promise<GitHubLabel[]> {
    return this.request<GitHubLabel[]>('GET', `/repos/${owner}/${repo}/labels?per_page=100`)
  }

  /**
   * Create a label in a repository.
   */
  async createLabel(owner: string, repo: string, input: {
    name: string
    color?: string
    description?: string
  }): Promise<GitHubLabel> {
    return this.request<GitHubLabel>('POST', `/repos/${owner}/${repo}/labels`, input)
  }

  /**
   * Add a comment to an issue.
   */
  async addComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    await this.request<unknown>(
      'POST',
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      { body },
    )
  }
}
