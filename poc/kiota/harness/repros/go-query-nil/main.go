package main

import (
    "fmt"
    "os"
    "time"
    kiota "github.com/microsoft/kiota-abstractions-go"
)

// Generated GET /issues has a nil optional createdFrom field of this shape.
func main() {
    defer func() {
        if failure:=recover();failure!=nil {fmt.Printf("v1.9.3 optional query panic: %v\n",failure);os.Exit(1)}
    }()
    info:=kiota.NewRequestInformation()
    info.AddQueryParameters(struct{CreatedFrom *time.Time `uriparametername:"createdFrom"`}{})
    fmt.Println("No panic")
}
