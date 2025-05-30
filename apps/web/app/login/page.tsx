"use client"

import type React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import axios from "axios"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import { Header } from "@/components/header"

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    if (!email || !password) {
      setError("Email and password are required")
      setIsLoading(false)
      return
    }

    try {
      const response = await axios.post("http://localhost:3002/api/auth/login", {
        email,
        password
      })

      if (response.data.token) {
        console.log("Login successful! Token received:", response.data.token)
        console.log("Token type:", typeof response.data.token)
        console.log("Token length:", response.data.token.length)
        
        // Ensure token is properly formatted
        const token = response.data.token.trim()
        console.log("Token after trim:", token)
        
        localStorage.setItem("token", token)
        console.log("Token stored in localStorage:", localStorage.getItem("token"))
        
        // Verify token format
        if (!token.startsWith('eyJ')) {
          console.warn("Token doesn't appear to be in JWT format")
        }
        
        router.push("/dashboard")
      } else {
        console.error("No token received in response:", response.data)
        setError("Invalid response from server")
      }
    } catch (error: any) {
      console.error("Login failed:", error)
      console.error("Error details:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      })
      setError(error.response?.data?.message || "Login failed. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container flex items-center justify-center p-4 min-h-[calc(100vh-3.5rem)]">
        <div className="w-full max-w-md">
          <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-8 transition-colors">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Arcade
          </Link>

          <Card className="border-border">
            <CardHeader className="text-center pb-8">
              <div className="w-12 h-12 bg-primary rounded-lg mx-auto mb-4 flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-lg">A</span>
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">Welcome back</CardTitle>
              <CardDescription className="text-muted-foreground">Sign in to your Arcade account</CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="text-destructive text-sm text-center bg-destructive/10 p-3 rounded-md">
                    {error}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground font-medium">
                    Email address
                  </Label>
                  <Input 
                    id="email" 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email" 
                    className="h-11" 
                    required 
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-foreground font-medium">
                    Password
                  </Label>
                  <Input 
                    id="password" 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password" 
                    className="h-11" 
                    required 
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Link href="/forgot-password" className="text-sm text-primary hover:text-primary/90">
                    Forgot your password?
                  </Link>
                </div>

                <Button type="submit" className="w-full h-11" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Sign in"}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-muted-foreground">
                  {"Don't have an account? "}
                  <Link href="/signup" className="text-primary hover:text-primary/90 font-medium">
                    Sign up for free
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
